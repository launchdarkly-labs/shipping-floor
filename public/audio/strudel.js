import { AGENTS, agentBus } from '../lib/dom.js';
import { store } from '../state/store.js';

/**
 * The browser owns the audio clock and the only real Strudel parser in the
 * system, which is what keeps AGPL-licensed Strudel isolated to this page —
 * the Node orchestrator only ever sends it strings.
 */

let repl = null;
let cps = 0.5;
let applyQueue = Promise.resolve();

export async function setupStrudel(initialCps = 0.5) {
  cps = initialCps;
  repl = await initStrudel();
  repl.setCps(cps);
}

export function setCps(next) {
  cps = next;
  repl?.setCps(next);
}

export const getCps = () => cps;
export const isReady = () => repl != null;

/**
 * Compose the band into one Strudel expression.
 *
 * `.orbit(n)` gives each musician its own effect bus, so one layer's reverb
 * send does not ride on another's. `.analyze(n)` sends THAT VOICE's post-gain
 * signal into analyser n, which is what makes per-agent visualisation
 * possible at all — a single master analyser could only ever show the band as
 * one blob. `.fft(5)` is fftSize 1024; the control's default of 8 means 8192,
 * which is four frames of latency for detail nobody can see at this size.
 *
 * Both indices come from the pinned AGENTS order, never from iteration order.
 */
export function composeStack() {
  const parts = [];
  for (const name of AGENTS) {
    const code = store.layers.get(name);
    if (!code || code === 'silence') continue;
    const bus = agentBus(name);
    parts.push(`  // ${name}\n  (${code}).orbit(${bus}).analyze(${bus}).fft(5)`);
  }
  return parts.length ? `stack(\n${parts.join(',\n')}\n)` : 'silence';
}

/**
 * Validate a candidate layer with Strudel's evaluator, then commit it at the
 * next cycle boundary. Returns { ok, error? }. Runs through a queue so
 * concurrent updates from different musicians cannot interleave mid-swap.
 */
export function applyLayer(layer, pattern) {
  const run = applyQueue.then(async () => {
    const previous = store.layers.get(layer);
    store.setLayer(layer, pattern);
    const candidate = composeStack();
    try {
      // autoplay=false: parse + evaluate without touching the transport.
      await evaluate(candidate, false);
    } catch (error) {
      if (previous === undefined) store.layers.delete(layer);
      else store.setLayer(layer, previous);
      // Restore the known-good pattern object (a failed evaluate may still
      // have replaced the scheduler's pattern in some strudel versions).
      await evaluate(composeStack(), false).catch(() => {});
      return { ok: false, error: String(error?.message ?? error) };
    }
    await nextCycleBoundary();
    await evaluate(candidate, false);
    return { ok: true };
  });
  applyQueue = run.catch(() => {});
  return run;
}

/** Resolve just before the next cycle boundary of the running scheduler. */
function nextCycleBoundary() {
  if (!store.playing) return Promise.resolve();
  const now = repl.scheduler.now(); // current time in cycles
  const cyclesToWait = Math.ceil(now + 0.05) - now;
  return new Promise((resolve) => setTimeout(resolve, (cyclesToWait / cps) * 1000));
}

/**
 * Start audio. The resume() is not optional: browsers suspend the audio
 * context until a user gesture, and without awaiting it the first Play press
 * produces a silent transport that looks like a bug in the band.
 */
export async function start() {
  await getAudioContext().resume();
  await evaluate(composeStack(), false);
  repl.start();
  store.set('playing', true);
}

export function stop() {
  repl?.stop();
  store.set('playing', false);
}
