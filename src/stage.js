import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

/**
 * ~100 ms. The meta payload grew roughly 40x when it started carrying
 * variations, snippet composition, ledger counters, and guardrail readings,
 * and updateMusicianMeta is called several times per generation. Firing a
 * full snapshot on every call would spend the whole demo serialising JSON.
 */
const META_COALESCE_MS = 100;

/**
 * The stage connects the orchestrator to the browser player over a
 * websocket. The browser owns the audio clock and the only real Strudel
 * parser in the system (keeping AGPL-licensed Strudel isolated to the
 * page), so pattern updates are a handshake:
 *
 *   server → { type: 'apply', id, layer, pattern }
 *   browser: parses the pattern with Strudel; on success swaps the layer in
 *            at the next cycle boundary, on failure keeps the old layer
 *   browser → { type: 'applied', id, ok, error? }
 *
 * Everything else the browser is told is split into two channels, and the
 * split is what makes the UI race-free:
 *
 *   'meta'  — an IDEMPOTENT, rev-stamped snapshot. Render it from scratch;
 *             replayed in full on connect, so a reconnect is always correct.
 *   'event' — an APPEND-ONLY stream of things that happened. Fire-and-forget,
 *             drives animation and the timeline, and is safe to drop.
 *
 * Animating from snapshots means diffing two states to guess what happened;
 * animating from events means being told. Reconnecting from events means
 * replaying history; reconnecting from a snapshot means just rendering it.
 */
export class Stage {
  /**
   * @param {import('node:http').Server} httpServer
   * @param {{ cps: number }} opts
   */
  constructor(httpServer, { cps }) {
    this.cps = cps;
    this.layers = new Map(); // layer name -> pattern string
    this.meta = { rev: 0, section: null, musicians: {} };
    this.pending = new Map(); // apply id -> resolve fn
    this.clients = new Set();
    this.metaTimer = null;

    this.wss = new WebSocketServer({ server: httpServer });
    this.wss.on('connection', (socket) => this.#onConnection(socket));
  }

  /**
   * Publish a layer update. Resolves with the browser's parse verdict,
   * or optimistically when no player is listening.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async applyLayer(layer, pattern) {
    const validator = this.#validator();
    if (!validator) {
      this.layers.set(layer, pattern);
      this.#broadcastMeta();
      return { ok: true };
    }

    const id = randomUUID();
    const verdict = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'player did not respond within 10s' });
      }, 10_000);
      this.pending.set(id, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      validator.send(JSON.stringify({ type: 'apply', id, layer, pattern }));
    });

    if (verdict.ok) {
      this.layers.set(layer, pattern);
      // Other connected tabs (if any) mirror the validated pattern.
      for (const client of this.clients) {
        if (client !== validator) {
          client.send(JSON.stringify({ type: 'apply', id: null, layer, pattern }));
        }
      }
      this.#broadcastMeta();
    }
    return verdict;
  }

  /** Patch the snapshot (section, listener, cycle) and schedule a flush. */
  updateMeta(patch) {
    Object.assign(this.meta, patch);
    this.#broadcastMeta();
  }

  updateMusicianMeta(name, patch) {
    this.meta.musicians[name] = { ...this.meta.musicians[name], ...patch };
    this.#broadcastMeta();
  }

  /**
   * Append to the event stream. Sent immediately and never replayed — an
   * event that arrives late is worse than one that never arrives, because
   * the animation it drives would fire against stale state.
   */
  pushEvent(event) {
    const payload = JSON.stringify({ type: 'event', event: { ...event, at: Date.now() } });
    for (const client of this.clients) client.send(payload);
  }

  #validator() {
    // First connected tab acts as the parser/player of record.
    return this.clients.values().next().value ?? null;
  }

  #onConnection(socket) {
    const isFirst = this.clients.size === 0;
    this.clients.add(socket);

    // A second tab is a SPECTATOR: its parse verdicts are never consulted, so
    // it must say so on screen. A presenter with two tabs open would
    // otherwise believe they were watching the machine that makes decisions.
    socket.send(JSON.stringify({
      type: 'init',
      role: isFirst ? 'validator' : 'spectator',
      cps: this.cps,
      layers: Object.fromEntries(this.layers),
      meta: this.meta,
    }));

    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message.type === 'applied' && this.pending.has(message.id)) {
        const resolve = this.pending.get(message.id);
        this.pending.delete(message.id);
        resolve({ ok: message.ok, error: message.error });
      }
    });

    socket.on('close', () => this.#drop(socket));
    socket.on('error', () => this.#drop(socket));
  }

  #drop(socket) {
    const wasValidator = this.#validator() === socket;
    this.clients.delete(socket);
    // Promote the next tab so closing the player window doesn't leave the
    // band publishing into a void that always says "ok".
    if (wasValidator) {
      const promoted = this.#validator();
      promoted?.send(JSON.stringify({ type: 'role', role: 'validator' }));
    }
  }

  #broadcastMeta() {
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      this.meta.rev += 1;
      const payload = JSON.stringify({
        type: 'meta',
        meta: this.meta,
        layers: Object.fromEntries(this.layers),
      });
      for (const client of this.clients) client.send(payload);
    }, META_COALESCE_MS);
  }
}
