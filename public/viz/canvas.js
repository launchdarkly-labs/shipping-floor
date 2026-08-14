import { AGENTS, agentBus, agentIndex } from '../lib/dom.js';
import { store, onEvent } from '../state/store.js';
import { getCps } from '../audio/strudel.js';

/**
 * Synthwave FORM language (horizon, sun, glow, particles) carrying FACTORY
 * semantics (the grid is a conveyor, particles are shipments).
 *
 * Each agent owns a horizontal band, a colour, AND a distinct mark form, so
 * identity survives greyscale, colour-vision deficiency, and a bad projector.
 * Three redundant encodings, because a demo is watched on other people's
 * screens.
 */
const BANDS = {
  drummer: { top: 0.00, bottom: 0.28, mark: 'bars' },
  bassist: { top: 0.28, bottom: 0.54, mark: 'ribbon' },
  keys: { top: 0.54, bottom: 0.82, mark: 'spokes' },
};

const PARTICLE_POOL = 240;
const FRAME_BUDGET_MS = 4;
const SHIP_BURST = 18;
const SHIP_MS = 900;
const WIPE_MS = 180;

/** One-way auto-degrade. Never climbs back — oscillating quality is worse. */
const QUALITY = ['high', 'med', 'low', 'off'];

export function mountCanvas(canvas, { motion = 'full' } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  // Held in a mutable local, not read from the mount argument: the argument is
  // captured once, so a later motion toggle would never reach drawGrid.
  let motionMode = motion;
  let quality = 0;
  let slowFrames = 0;

  // Zero per-frame allocation: preallocated scratch per agent and a fixed
  // particle pool. A 45-minute demo must not grow memory or trigger GC pauses
  // in the middle of the money shot.
  const scratch = new Map(AGENTS.map((name) => [name, new Float32Array(512)]));
  const particles = Array.from({ length: PARTICLE_POOL }, () => ({ life: 0 }));
  let nextParticle = 0;
  const wipes = new Map();

  onEvent((event) => {
    if (event.type === 'shipped') {
      spawnBurst(event.musician, false);
      wipes.set(event.musician, performance.now());
    }
    if (event.type === 'rejected') spawnBurst(event.musician, true);
  });

  function spawnBurst(musician, rejected) {
    const index = agentIndex(musician);
    if (index < 0) return;
    for (let i = 0; i < SHIP_BURST; i += 1) {
      const p = particles[nextParticle];
      nextParticle = (nextParticle + 1) % PARTICLE_POOL;
      p.life = 1;
      p.agent = index;
      // A rejected pattern's particles fall BELOW the conveyor. The shipment
      // that did not ship is visibly not on the line.
      p.rejected = rejected;
      p.x = Math.random();
      p.y = 0;
      p.vx = (Math.random() - 0.5) * 0.004;
      p.vy = (rejected ? 1 : -1) * (0.002 + Math.random() * 0.004);
    }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (canvas.width === w * dpr && canvas.height === h * dpr) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // getDrawContext() reuses an existing element and only attaches its own
  // resize listener when it CREATES one — so by pre-placing the canvas in the
  // HTML we own resize, and there is no second listener fighting ours.
  //
  // A window resize listener alone is not enough: switching layout mode with
  // 1/2/3 hides the Control Tower and changes the canvas's box without the
  // window changing size at all, which would leave a stale bitmap stretched
  // across the new dimensions. Observe the element, not the window.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();

  /**
   * Which visual tier is actually running. This must be on screen: a tutorial
   * must never let a viewer believe they are watching audio when they are
   * watching a clock.
   *
   *   analysis — real per-agent FFT/time-domain data (default)
   *   clock    — transport stopped, audio context suspended, or burn-in
   */
  function tier() {
    if (!store.playing) return 'clock';
    return typeof globalThis.getAnalyzerData === 'function' ? 'analysis' : 'clock';
  }

  function readAnalyser(name, mode) {
    // window.analysers[id] does not exist until that layer's first voice has
    // fired, and getAnalyzerData returns undefined until it does. Guard hard:
    // this is the single most likely runtime error in the whole page.
    try {
      const data = globalThis.getAnalyzerData?.(mode, agentBus(name));
      return data && data.length ? data : null;
    } catch {
      return null;
    }
  }

  return {
    setMotion(next) {
      motionMode = next;
    },

    render(now) {
      const started = performance.now();
      if (QUALITY[quality] === 'off') return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const mode = tier();
      store.set('visual', mode);

      ctx.fillStyle = '#07060f';
      ctx.fillRect(0, 0, w, h);

      drawHorizon(ctx, w, h, now);
      drawGrid(ctx, w, h, now, motionMode);

      for (const name of AGENTS) {
        const band = BANDS[name];
        const y0 = band.top * h;
        const y1 = band.bottom * h;
        const colour = getComputedStyle(canvas).getPropertyValue(`--agent-${agentIndex(name)}`).trim() || '#888';

        // The offending agent dims to 35% while the other two keep their
        // colour. That CONTRAST is the message during a rollback — a uniform
        // alarm state says "something is wrong", this says "it is the bassist".
        const dimmed = store.musician(name).status?.startsWith('retrying');
        ctx.globalAlpha = dimmed ? 0.35 : 1;

        const data = mode === 'analysis' ? readAnalyser(name, band.mark === 'ribbon' ? 'time' : 'frequency') : null;
        if (data) drawMark(ctx, band.mark, data, scratch.get(name), w, y0, y1, colour);
        else drawIdle(ctx, band.mark, w, y0, y1, colour, now);

        ctx.globalAlpha = 1;
        drawWipe(ctx, wipes, name, w, y0, y1, colour, now);
      }

      drawParticles(ctx, particles, w, h);

      // One-way degrade with a visible chip, so a struggling laptop loses
      // detail rather than dropping audio frames.
      const spent = performance.now() - started;
      if (spent > FRAME_BUDGET_MS) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 60 && quality < QUALITY.length - 1) {
        quality += 1;
        slowFrames = 0;
      }
    },
    quality: () => QUALITY[quality],
  };
}

function drawHorizon(ctx, w, h, now) {
  const y = h * 0.82;
  const sun = ctx.createRadialGradient(w / 2, y, 0, w / 2, y, h * 0.4);
  sun.addColorStop(0, 'rgba(255,140,90,0.45)');
  sun.addColorStop(1, 'rgba(255,140,90,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
}

/** Horizontal lines scroll exactly one line per beat — a visible metronome. */
function drawGrid(ctx, w, h, now, motion) {
  const y0 = h * 0.82;
  const beats = motion === 'off' ? 0 : (now / 1000) * getCps() * 4;
  ctx.strokeStyle = 'rgba(120,200,255,0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    const t = ((i + (beats % 1)) / 12) ** 2;
    const y = y0 + t * (h - y0);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawMark(ctx, mark, data, scratch, w, y0, y1, colour) {
  const h = y1 - y0;
  const n = Math.min(data.length, scratch.length);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;

  if (mark === 'bars') {
    const bw = w / n;
    for (let i = 0; i < n; i += 1) {
      const level = normalise(data[i]);
      ctx.fillRect(i * bw, y1 - level * h, Math.max(1, bw - 1), level * h);
    }
    return;
  }

  if (mark === 'ribbon') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const y = y0 + h / 2 + normalise(data[i], true) * (h / 2);
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo((i / n) * w, y);
    }
    ctx.stroke();
    return;
  }

  // spokes — radial from the sun
  ctx.lineWidth = 2;
  const cx = w / 2;
  const cy = y1;
  for (let i = 0; i < n; i += 8) {
    const level = normalise(data[i]);
    const angle = Math.PI + (i / n) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * level * h * 2, cy + Math.sin(angle) * level * h * 2);
    ctx.stroke();
  }
}

/** Fallback C: no analyser data. Still alive, but visibly a clock. */
function drawIdle(ctx, mark, w, y0, y1, colour, now) {
  ctx.strokeStyle = colour;
  ctx.globalAlpha *= 0.3;
  ctx.lineWidth = 2;
  const y = y0 + (y1 - y0) / 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  ctx.globalAlpha /= 0.3;
}

/**
 * The release, as distinct from the shipment. A 180 ms full-height wipe
 * across ONLY that agent's band, tied to the audible cycle boundary. The ship
 * burst is the artifact being produced; the wipe is it going live. Those
 * being two visually distinct events, 1.1 seconds apart, is the whole
 * build-side/release-side idea rendered without a word of copy.
 */
function drawWipe(ctx, wipes, name, w, y0, y1, colour, now) {
  const started = wipes.get(name);
  if (!started) return;
  const t = (performance.now() - started) / WIPE_MS;
  if (t > 1) {
    wipes.delete(name);
    return;
  }
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.5;
  ctx.fillStyle = colour;
  ctx.fillRect(t * w - 40, y0, 40, y1 - y0);
  ctx.restore();
}

function drawParticles(ctx, particles, w, h) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= 1 / (SHIP_MS / 16);
    p.x += p.vx;
    p.y += p.vy;
    if (p.life <= 0) continue;
    ctx.globalAlpha = Math.max(0, p.life) * 0.8;
    ctx.fillStyle = getComputedStyle(ctx.canvas).getPropertyValue(`--agent-${p.agent}`).trim() || '#fff';
    const y = h * 0.82 + p.y * h;
    ctx.fillRect(p.x * w, y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

function normalise(value, signed = false) {
  // Strudel's analyser yields either byte-ish magnitudes or -1..1 floats
  // depending on the requested type; accept both rather than assume.
  if (signed) return Math.max(-1, Math.min(1, value > 2 ? value / 128 - 1 : value));
  return Math.max(0, Math.min(1, value > 2 ? value / 255 : Math.abs(value)));
}
