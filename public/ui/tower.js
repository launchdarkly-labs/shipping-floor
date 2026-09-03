import { $, setText, setFlag, setLink, formatGain } from '../lib/dom.js';
import { publishRate, breachRate, formatRate } from '../lib/rates.js';
import { store } from '../state/store.js';
import { describeReason, describeServing } from './reasons.js';

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 28;

/**
 * The Control Tower: everything about the ONE selected agent.
 *
 * Every fact in this rail lives in the DOM. The canvas only dramatises. That
 * is not a stylistic preference — it is what makes the accessibility rule
 * ("no quality gate may be audio-only") achievable, and it is why turning the
 * canvas off loses no information.
 */
export function mountTower() {
  const ui = {
    agent: $('tower-agent'),
    config: $('tower-config'),
    variation: $('tower-variation'),
    model: $('tower-model'),
    contexts: $('tower-contexts'),
    reason: $('tower-reason'),
    edit: $('tower-edit'),

    snippets: $('tower-snippets'),
    promptFooter: $('tower-prompt-footer'),

    gate: $('tower-gate'),

    publishRate: $('tower-publish-rate'),
    breachRate: $('tower-breach-rate'),
    gain: $('tower-gain'),
    ceiling: $('tower-ceiling'),
    breaches: $('tower-breaches'),
    held: $('tower-held'),
    published: $('tower-published'),
    spark: $('tower-spark'),

    split: $('tower-split'),
  };

  return {
    update(selected) {
      const info = store.musician(selected);
      setText(ui.agent, selected);

      // ---- SERVING -------------------------------------------------------
      setText(ui.config, info.configKey);
      const serving = describeServing(info.variation);
      setText(ui.variation, serving.text);
      setFlag(ui.variation, 'alarm', serving.alarm);
      setText(ui.model, info.model);
      setText(ui.contexts, info.context ? Object.values(info.context).join(' · ') : null);
      // Which arm of the code change this agent last ran under. Without it the
      // ceiling below is unexplained: the reader sees a limit they never set.
      setText(ui.gate, info.strictMixGate == null ? null : info.strictMixGate ? 'true · strict' : 'false');
      setFlag(ui.gate, 'alarm', Boolean(info.strictMixGate));
      setText(ui.reason, describeReason(selected, info.reason));
      setLink(ui.edit, info.configUrl);

      // ---- PROMPT COMPOSITION -------------------------------------------
      renderSnippets(ui.snippets, info.snippets ?? []);
      // Never render the assembled prompt text itself. A token count and a
      // hash are the honest summary — the full text is large, is not the
      // reader's to review here, and putting a model's system prompt on a
      // projector is a good way to leak something you did not mean to.
      setText(
        ui.promptFooter,
        info.snippets?.length ? `${info.snippets.length} snippets · pinned` : 'no snippet declaration',
      );

      // ---- GUARDRAILS ----------------------------------------------------
      const ledger = info.ledger ?? {};
      // The ENFORCED ceiling, which is the strict one whenever strict-mix-gate
      // is on. Showing the variation's nominal ceiling here made the HUD
      // disagree with the validator during the one rollout it exists to
      // explain, and made a legitimate rejection look like a bug.
      const ceiling = info.enforcedCeiling ?? info.gainCeiling;
      setText(ui.publishRate, formatRate(publishRate(ledger)));
      setText(ui.breachRate, formatRate(breachRate(ledger)));
      setText(ui.gain, formatGain(info.gain));
      setText(ui.ceiling, ceiling == null ? '—' : ceiling.toFixed(2));
      setText(ui.breaches, ledger.ceilingBreaches ?? 0);
      setText(ui.held, ledger.keptPrevious ?? 0);
      setText(ui.published, ledger.published ?? 0);

      const breaching = ceiling != null && info.gain != null && info.gain > ceiling;
      // A breach is encoded FOUR ways — colour, a filled point on the
      // sparkline, a flag glyph, and the word itself — so it survives
      // greyscale, colour-vision deficiency, and a bad projector.
      setFlag(ui.gain, 'breaching', breaching);
      setText($('tower-gain-word'), breaching ? 'breaching' : 'within');
      // Written directly rather than through setText: setText renders an
      // em-dash placeholder for empty values, which is right for a missing
      // reading but wrong for a flag glyph whose absence IS the good state.
      $('tower-gain-glyph').textContent = breaching ? '⚑' : '';

      drawSparkline(ui.spark, store.samplesFor(selected), ceiling);

      // ---- SERVED SPLIT --------------------------------------------------
      renderSplit(ui.split, store.splitFor(selected));
    },
  };
}

function renderSnippets(root, snippets) {
  const key = snippets.map((s) => `${s.key}#${s.version}`).join('|');
  if (root.dataset.key === key) return;
  root.dataset.key = key;
  root.replaceChildren();

  if (!snippets.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'waiting for the first generation';
    root.append(empty);
    return;
  }

  for (const snippet of snippets) {
    const row = document.createElement('div');
    row.className = 'snippet-row';

    const name = document.createElement('code');
    name.textContent = snippet.key;

    const version = document.createElement('span');
    version.className = 'pill';
    // Pinned vs floating is encoded by GLYPH, not colour: a filled dot is a
    // pinned version, an arrow tracks latest. Colour alone would vanish for a
    // colour-blind reader and on a washed-out projector.
    version.textContent = snippet.version == null ? '↑ latest' : `● v${snippet.version}`;

    row.append(name, version);
    root.append(row);
  }
}

/**
 * The sparkline always includes the threshold in its range, and the dashed
 * threshold rule is the ONLY reference line. A sparkline auto-scaled to its
 * own data makes a 2% wobble look like a catastrophe and a real breach look
 * like nothing.
 */
function drawSparkline(svg, samples, ceiling) {
  if (!svg) return;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`);
  if (!samples.length || ceiling == null) return;

  const max = Math.max(ceiling * 1.1, ...samples);
  const y = (value) => SPARK_HEIGHT - (value / max) * SPARK_HEIGHT;
  const x = (index) => (index / Math.max(1, samples.length - 1)) * SPARK_WIDTH;

  const threshold = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  threshold.setAttribute('x1', 0);
  threshold.setAttribute('x2', SPARK_WIDTH);
  threshold.setAttribute('y1', y(ceiling));
  threshold.setAttribute('y2', y(ceiling));
  threshold.setAttribute('class', 'spark-threshold');
  svg.append(threshold);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  path.setAttribute('points', samples.map((value, index) => `${x(index)},${y(value)}`).join(' '));
  path.setAttribute('class', 'spark-line');
  svg.append(path);

  for (const [index, value] of samples.entries()) {
    if (value <= ceiling) continue;
    const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    point.setAttribute('cx', x(index));
    point.setAttribute('cy', y(value));
    point.setAttribute('r', 2.5);
    point.setAttribute('class', 'spark-breach');
    svg.append(point);
  }
}

/**
 * What was actually served, measured from traffic.
 *
 * A single variation at 100% is a stable rule. Two variations sharing the bar
 * is a percentage rollout — and during a guarded rollout you watch the
 * treatment arm's share climb, then snap back to zero when LaunchDarkly
 * reverts it. That reversion is the most legible thing in the whole UI, and it
 * costs no API call because it is just arithmetic over events we already have.
 */
function renderSplit(root, split) {
  if (!root) return;
  const rows = root.querySelector('.split-rows');
  const empty = root.querySelector('.split-empty');
  const note = root.querySelector('.split-note');

  empty.hidden = split.total > 0;
  note.hidden = split.total === 0;
  setText(root.querySelector('.split-total'), split.total);

  const key = split.entries.map((e) => `${e.key}:${e.percent}`).join('|');
  if (rows.dataset.key === key) return;
  rows.dataset.key = key;
  rows.replaceChildren();

  for (const entry of split.entries) {
    const row = document.createElement('div');
    row.className = 'split-row';

    const label = document.createElement('code');
    label.textContent = entry.key;

    const percent = document.createElement('span');
    percent.className = 'split-percent';
    // Always print the number. A bar alone forces the viewer to estimate.
    percent.textContent = `${entry.percent}%`;

    const bar = document.createElement('span');
    bar.className = 'split-bar';
    const fill = document.createElement('span');
    fill.className = 'split-fill';
    fill.style.setProperty('--percent', `${entry.percent}%`);
    bar.append(fill);

    row.append(label, percent, bar);
    rows.append(row);
  }
}
