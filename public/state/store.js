import { AGENTS } from '../lib/dom.js';

/** Hard caps, so a 45-minute demo cannot grow memory without bound. */
const MAX_TIMELINE = 200;
const MAX_SAMPLES = 30;

/**
 * One store, two channels.
 *
 * `meta` is an idempotent snapshot: it is replaced wholesale and rendered
 * from scratch, so a reconnect is just another render and can never leave the
 * UI half-updated. `events` is an append-only log of things that happened,
 * which is what animation needs — diffing two snapshots to infer "a pattern
 * shipped" is guesswork, being told is not.
 *
 * The socket handler NEVER renders. It writes here and sets a dirty flag; one
 * requestAnimationFrame in the whole application does the drawing. That is
 * what keeps DOM work from ever starving the audio thread.
 */
class Store {
  constructor() {
    this.meta = { rev: -1, musicians: {} };
    this.layers = new Map();
    this.role = 'spectator';
    this.connected = false;
    this.playing = false;
    this.visual = 'clock'; // 'analysis' | 'events' | 'clock'
    this.timeline = [];
    this.dirty = true;

    // Per-agent rolling samples for the guardrail sparklines.
    this.samples = new Map(AGENTS.map((name) => [name, []]));

    // Per-agent history of which variation was actually served, newest last.
    this.served = new Map(AGENTS.map((name) => [name, []]));
  }

  /**
   * Replace the snapshot. Ignores anything older than what we already have.
   *
   * `reset` must be passed for the `init` snapshot, because rev is only
   * monotonic within one server process. The server restarts its counter at 0
   * while a tab that reconnects over the same socket keeps its accumulated rev,
   * so without this the guard discards the init snapshot and every meta after
   * it until the new process climbs past the old one's count — minutes, during
   * which events still animate over a frozen ledger and the page looks alive
   * while lying. Any restart with a tab open hits this.
   */
  applyMeta(meta, { reset = false } = {}) {
    if (reset) this.meta = { rev: -1, musicians: {} };
    if (meta.rev != null && meta.rev <= this.meta.rev) return;
    this.meta = meta;

    for (const name of AGENTS) {
      const gain = meta.musicians?.[name]?.gain;
      if (gain == null) continue;
      const ring = this.samples.get(name);
      if (ring[ring.length - 1] !== gain) {
        ring.push(gain);
        if (ring.length > MAX_SAMPLES) ring.shift();
      }
    }
    this.dirty = true;
  }

  applyEvent(event) {
    this.timeline.push(event);
    if (this.timeline.length > MAX_TIMELINE) this.timeline.shift();

    if (event.type === 'shipped' && event.variationKey) {
      const ring = this.served.get(event.musician);
      if (ring) {
        ring.push(event.variationKey);
        if (ring.length > MAX_SAMPLES) ring.shift();
      }
    }

    this.dirty = true;
    for (const listener of eventListeners) listener(event);
  }

  setLayer(name, pattern) {
    this.layers.set(name, pattern);
    this.dirty = true;
  }

  set(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    this.dirty = true;
  }

  musician(name) {
    return this.meta.musicians?.[name] ?? {};
  }

  samplesFor(name) {
    return this.samples.get(name) ?? [];
  }

  /**
   * The observed split of served variations for one agent, commonest first.
   * This is measured from traffic that actually happened, not read from a
   * targeting config — so it reflects percentage rollouts, rule matches, and
   * a guarded rollout ramping, all without asking LaunchDarkly anything.
   */
  splitFor(name) {
    const ring = this.served.get(name) ?? [];
    const counts = new Map();
    for (const key of ring) counts.set(key, (counts.get(key) ?? 0) + 1);
    return {
      total: ring.length,
      entries: [...counts]
        .map(([key, count]) => ({ key, count, percent: Math.round((count / ring.length) * 100) }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Aggregate ledger across the band — the Factory Ledger totals. */
  totals() {
    const sum = { generations: 0, published: 0, lintRejected: 0, parseRejected: 0, ceilingBreaches: 0, retries: 0, keptPrevious: 0, configInvalid: 0 };
    for (const name of AGENTS) {
      const ledger = this.musician(name).ledger;
      if (!ledger) continue;
      for (const key of Object.keys(sum)) sum[key] += ledger[key] ?? 0;
    }
    return sum;
  }
}

const eventListeners = [];

/** Subscribe to the append-only event stream (animation, not rendering). */
export function onEvent(listener) {
  eventListeners.push(listener);
}

export const store = new Store();
