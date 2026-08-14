import { setFlag, setText } from '../lib/dom.js';
import { store, onEvent } from '../state/store.js';

/**
 * A stage holds `active` for at least this long even when the real step took
 * 40 ms. Below roughly a third of a second the eye cannot follow a state
 * change at all — the dot would flicker and read as noise rather than as a
 * step completing.
 */
const MIN_ACTIVE_MS = 700;

/**
 * The production line: six nodes in two labelled groups, separated by a seam.
 *
 *   Generate │ Classify · Flag · Measure · Release · Clean up
 *   BUILD    ‖ RELEASE
 *
 * The seam is the argument of the whole repo rendered as a piece of layout.
 * Everything left of it is the part you already built — an agent producing an
 * artifact. Everything right of it is the part that was missing. A reader who
 * looks at nothing else should still come away with "the left half was
 * already there, and the right half is what LaunchDarkly is for."
 */
const STAGES = [
  { key: 'generate', label: 'Generate', group: 'build' },
  { key: 'classify', label: 'Classify', group: 'release' },
  { key: 'flag', label: 'Flag', group: 'release' },
  { key: 'measure', label: 'Measure', group: 'release' },
  { key: 'release', label: 'Release', group: 'release' },
  { key: 'cleanup', label: 'Clean up', group: 'release' },
];

export function mountLine(root) {
  const nodes = new Map();

  for (const stage of STAGES) {
    const el = document.createElement('div');
    el.className = 'line-node';
    el.dataset.group = stage.group;
    el.dataset.state = 'idle';

    const dot = document.createElement('span');
    dot.className = 'line-dot';
    const label = document.createElement('span');
    label.className = 'line-label';
    label.textContent = stage.label;
    const count = document.createElement('span');
    count.className = 'line-count';
    count.textContent = '0';

    el.append(dot, label, count);
    root.append(el);
    nodes.set(stage.key, { el, count, until: 0 });
  }

  const activate = (key, state = 'active') => {
    const node = nodes.get(key);
    if (!node) return;
    node.el.dataset.state = state;
    node.until = performance.now() + MIN_ACTIVE_MS;
  };

  onEvent((event) => {
    if (event.type === 'shipped') activate('generate', 'done');
    if (event.type === 'rejected') activate('generate', 'alarm');
    if (event.type === 'alarm') activate('generate', 'alarm');
  });

  return {
    update() {
      const totals = store.totals();
      setText(nodes.get('generate').count, totals.generations);
      setText(nodes.get('measure').count, totals.ceilingBreaches);

      const now = performance.now();
      for (const [, node] of nodes) {
        if (node.until && now > node.until) {
          node.el.dataset.state = 'idle';
          node.until = 0;
        }
      }

      // The five release stages are driven by a human running the factory
      // slash commands, not by the band. Saying "skipped" is more honest than
      // an idle dot that implies the step is about to happen on its own.
      for (const stage of STAGES) {
        if (stage.group !== 'release') continue;
        const node = nodes.get(stage.key);
        if (node.until) continue;
        setFlag(node.el, 'unattended', true);
      }
    },
  };
}
