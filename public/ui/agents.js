import { AGENTS, agentIndex, fromTemplate, setText, setFlag, formatGain } from '../lib/dom.js';
import { store } from '../state/store.js';
import { describeServing } from './reasons.js';

/**
 * The agent rack: three peers you compare at a glance, exactly one expanded.
 *
 * The previous card layout tried to be both a LIST (three musicians, compare
 * them) and a DETAIL VIEW (everything about each one) at the same time, and
 * broke at both. Three agents x five instrumentation panels fits nowhere;
 * one agent x five panels fits comfortably in the 340px Control Tower rail.
 * So the rack is the list and the tower is the detail.
 *
 * Each row carries a 3-bar mini gain meter at ~10 Hz. That is deliberate
 * duplication: it is the one fact the canvas uniquely carried (which agent is
 * loud right now), so with the canvas off nothing is actually lost.
 */
export function mountAgents(root, { onSelect }) {
  const rows = new Map();

  for (const name of AGENTS) {
    const row = fromTemplate('tpl-agent-row');
    row.dataset.agent = name;
    row.style.setProperty('--agent-index', agentIndex(name));
    setText(row.querySelector('.agent-name'), name);

    row.addEventListener('click', () => onSelect(name));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(name);
      }
    });

    root.append(row);
    rows.set(name, {
      row,
      status: row.querySelector('.agent-status'),
      variation: row.querySelector('.agent-variation'),
      gain: row.querySelector('.agent-gain'),
      pattern: row.querySelector('.agent-pattern'),
      meter: [...row.querySelectorAll('.meter-bar')],
      lastPattern: null,
    });
  }

  return {
    update(selected) {
      for (const [name, ui] of rows) {
        const info = store.musician(name);
        setFlag(ui.row, 'selected', name === selected);
        ui.row.setAttribute('aria-expanded', String(name === selected));

        setText(ui.status, info.status);
        setFlag(ui.row, 'thinking', /thinking|retrying/.test(info.status ?? ''));

        const serving = describeServing(info.variation);
        setText(ui.variation, serving.text);
        setFlag(ui.variation, 'alarm', serving.alarm);

        setText(ui.gain, formatGain(info.gain));
        const ceiling = info.gainCeiling;
        setFlag(ui.gain, 'breaching', ceiling != null && info.gain != null && info.gain > ceiling);

        // Three bars of the recent gain history — the canvas-off twin of
        // "which agent is loud right now".
        const samples = store.samplesFor(name).slice(-3);
        for (const [index, bar] of ui.meter.entries()) {
          const value = samples[index];
          const height = value == null || !ceiling ? 0 : Math.min(1, value / ceiling);
          bar.style.setProperty('--level', height.toFixed(3));
        }

        const pattern = info.pattern ?? '';
        if (ui.lastPattern !== pattern) {
          // A pattern is an opaque generated artifact. The reader is not
          // expected to read Strudel — this is "the code the drummer just
          // shipped", treated exactly as generated code in a language you
          // do not use.
          setText(ui.pattern, pattern);
          ui.lastPattern = pattern;
          pulse(ui.row);
        }
      }
    },
  };
}

function pulse(row) {
  setFlag(row, 'fresh', true);
  setTimeout(() => setFlag(row, 'fresh', false), 900);
}
