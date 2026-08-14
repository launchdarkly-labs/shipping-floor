import { store } from '../state/store.js';
import { applyLayer, setCps, isReady } from '../audio/strudel.js';

/**
 * The socket handler never renders. It writes to the store and sets a dirty
 * flag; the single requestAnimationFrame loop in app.js does all drawing.
 * A render triggered from a message handler competes with the audio thread
 * on exactly the frames where the most is happening.
 */
export function connect() {
  const ws = new WebSocket(`ws://${location.host}`);

  ws.addEventListener('open', () => store.set('connected', true));

  ws.addEventListener('close', () => {
    store.set('connected', false);
    setTimeout(connect, 1500);
  });

  ws.addEventListener('message', async (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'init': {
        // Role matters on screen: a second tab's parse verdicts are never
        // consulted, so it must not look like the machine making decisions.
        store.set('role', message.role);
        setCps(message.cps);
        for (const [layer, pattern] of Object.entries(message.layers)) {
          await applyLayer(layer, pattern);
        }
        // reset: this connection may be to a fresh server process whose rev
        // counter restarted below the one this tab has accumulated.
        store.applyMeta(message.meta, { reset: true });
        return;
      }

      case 'role':
        store.set('role', message.role);
        return;

      case 'apply': {
        const result = isReady()
          ? await applyLayer(message.layer, message.pattern)
          : { ok: false, error: 'player not ready' };
        // Only the validator is asked for a verdict (message.id is null for
        // the mirrored copy sent to spectator tabs).
        if (message.id) {
          ws.send(JSON.stringify({ type: 'applied', id: message.id, ...result }));
        }
        return;
      }

      case 'meta':
        store.applyMeta(message.meta);
        return;

      case 'event':
        store.applyEvent(message.event);
        return;
    }
  });
}
