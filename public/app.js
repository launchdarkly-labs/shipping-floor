import { AGENTS, $, setText, setFlag, safeUrl } from './lib/dom.js';
import { publishRate, formatRate } from './lib/rates.js';
import { store, onEvent } from './state/store.js';
import { connect } from './net/socket.js';
import { setupStrudel, start, stop } from './audio/strudel.js';
import { mountAgents } from './ui/agents.js';
import { mountTower } from './ui/tower.js';
import { mountLine } from './ui/line.js';
import { mountCanvas } from './viz/canvas.js';

const MODES = ['showroom', 'factory', 'burnin'];
const MOTION = ['full', 'calm', 'off'];

let selected = AGENTS[0];
let mode = 'factory';
let motion = 'full';
let canvas = null;

/**
 * One requestAnimationFrame in the whole application.
 *
 * Every panel exports mount(root) → { update(next) }, holds its own previous
 * state, and writes only changed fields. The socket handler never renders; it
 * writes to the store and sets a dirty flag, which this loop consumes. DOM
 * work can therefore never starve the audio thread, no matter how much
 * arrives at once.
 */
function boot() {
  const agents = mountAgents($('agent-rack'), { onSelect: select });
  const tower = mountTower();
  const line = mountLine($('production-line'));
  canvas = mountCanvas($('test-canvas'), { motion });

  restorePreferences();
  wireTransport();
  wireKeyboard();
  wireAnnouncements();

  function frame(now) {
    if (store.dirty) {
      store.dirty = false;
      agents.update(selected);
      tower.update(selected);
      line.update();
      renderChrome();
    }
    // The canvas rides the same frame but is not gated on the dirty flag —
    // it is continuous, and in reduced motion it repaints only once a cycle.
    if (motion !== 'off') canvas.render(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderChrome() {
  setText($('section-value'), store.meta.section);
  setText($('energy-value'), store.meta.energy);
  setText($('cycle-value'), store.meta.cycle);

  const conn = $('conn');
  setText(conn, store.connected ? 'orchestrator connected' : 'reconnecting…');
  setFlag(conn, 'connected', store.connected);

  // A second tab's parse verdicts are silently discarded, so it says so.
  // A presenter with two tabs open must not be fooled about which one is
  // making decisions.
  const role = $('role-chip');
  setText(role, store.role === 'validator' ? 'VALIDATOR' : 'SPECTATOR');
  setFlag(role, 'spectator', store.role !== 'validator');

  // Never let a viewer believe they are seeing audio when they are not.
  const visual = $('visual-chip');
  setText(visual, store.visual === 'analysis' ? 'VISUAL: AUDIO' : 'VISUAL: CLOCK');
  setFlag(visual, 'degraded', store.visual !== 'analysis');

  renderLdBar();

  const totals = store.totals();
  // Band-wide publish rate, first, because it is the guardrail that decides
  // the code change and the one failure you cannot hear.
  setText($('ledger-publish-rate'), formatRate(publishRate(totals)));
  setText($('ledger-generations'), totals.generations);
  setText($('ledger-published'), totals.published);
  setText($('ledger-rejected'), totals.lintRejected + totals.parseRejected);
  setText($('ledger-held'), totals.keptPrevious);
}

/**
 * One link per agent, plus one to the project, always on screen.
 *
 * There is deliberately no in-app control for changing what an instrument
 * plays. Which vocabulary an agent gets is a TARGETING decision, and routing
 * every arrangement change through LaunchDarkly is the entire point — it is
 * what makes the change auditable, revertible, and someone's name in a log
 * rather than a command on one laptop. So the honest UI affordance is not a
 * dropdown, it is a prominent door to the place where the decision lives.
 */
function renderLdBar() {
  const bar = $('ld-bar');
  const urls = AGENTS.map((name) => store.musician(name).configUrl ?? null);
  const key = urls.join('|');
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;

  // Keep the label, replace the links.
  for (const link of bar.querySelectorAll('.ld-link')) link.remove();

  for (const [index, name] of AGENTS.entries()) {
    const href = safeUrl(urls[index]);
    if (!href) continue;
    bar.append(buildLink(href, name, name));
  }

  // Derive the project page from any config URL rather than threading another
  // field through the meta contract.
  const projectUrl = safeUrl((urls.find(Boolean) ?? '').replace(/\/ai-configs\/[^/]+$/, ''));
  if (projectUrl) {
    const link = buildLink(projectUrl, null, 'project ↗');
    link.classList.add('project');
    bar.append(link);
  }
}

function buildLink(href, agent, label) {
  const link = document.createElement('a');
  link.className = 'ld-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  if (agent) {
    link.dataset.agent = agent;
    const swatch = document.createElement('span');
    swatch.className = 'ld-swatch';
    link.append(swatch);
  }
  const text = document.createElement('span');
  text.textContent = label;
  link.append(text);
  return link;
}

function select(name) {
  selected = name;
  store.dirty = true;
}

function setMode(next) {
  if (!MODES.includes(next)) return;
  mode = next;
  document.documentElement.dataset.mode = mode;
  location.hash = mode; // so a demo can be deep-linked
  localStorage.setItem('shipping-floor.mode', mode);
  store.dirty = true;
}

function setMotion(next) {
  motion = next;
  document.documentElement.dataset.motion = motion;
  localStorage.setItem('shipping-floor.motion', motion);
  // Both of these have to happen here rather than in the click handler.
  // restorePreferences() also calls setMotion, and when it restored 'off' or
  // 'calm' the button still read "motion: full" above a canvas that had
  // stopped, which reads as a broken page rather than a setting.
  setText($('motion'), `motion: ${motion}`);
  canvas?.setMotion(motion);
  store.dirty = true;
}

function restorePreferences() {
  const fromHash = location.hash.replace('#', '');
  setMode(MODES.includes(fromHash) ? fromHash : localStorage.getItem('shipping-floor.mode') ?? 'factory');

  // A JS motion policy is required on top of the CSS media query, because CSS
  // cannot reach the canvas. prefers-reduced-motion is also almost never set
  // on a demo laptop, while a projector still benefits — hence a manual
  // three-state control rather than only the query.
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setMotion(localStorage.getItem('shipping-floor.motion') ?? (prefersReduced ? 'calm' : 'full'));
}

function wireTransport() {
  $('play').addEventListener('click', async () => {
    if (store.playing) {
      stop();
      setText($('play'), '▶ Play');
      return;
    }
    setText($('play'), '■ Stop');
    await start();
  });

  $('motion').addEventListener('click', () => {
    setMotion(MOTION[(MOTION.indexOf(motion) + 1) % MOTION.length]);
  });
}

/** Full keyboard operation, so a presenter never needs the mouse. */
function wireKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea')) return;
    if (event.key === '1') setMode('showroom');
    if (event.key === '2') setMode('factory');
    if (event.key === '3') setMode('burnin');
    if (event.key === ' ') {
      event.preventDefault();
      $('play').click();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      select(AGENTS[(AGENTS.indexOf(selected) + step + AGENTS.length) % AGENTS.length]);
    }
  });
}

/**
 * Exactly two live regions. A polite ticker for routine traffic, and an
 * assertive one reserved for breach, rollback, and recovery — the three
 * moments a screen-reader user must not miss. More than two and they
 * interrupt each other into noise.
 */
function wireAnnouncements() {
  const polite = $('sr-polite');
  const assertive = $('sr-assertive');

  onEvent((event) => {
    if (event.type === 'shipped') {
      polite.textContent = `${event.musician} shipped a new pattern`;
    } else if (event.type === 'rejected' && event.ceilingExceeded) {
      assertive.textContent = `${event.musician} breached its gain ceiling`;
    } else if (event.type === 'alarm') {
      assertive.textContent = `${event.musician}: ${event.reason}`;
    } else if (event.type === 'section') {
      polite.textContent = `section ${event.section}, energy ${event.energy}`;
      // Scene description updates once per SECTION, not per frame — a canvas
      // narrated at 60 Hz is unusable.
      $('canvas-description').textContent =
        `Three horizontal bands over a synthwave horizon, one per musician, reacting to a ${event.energy}-energy ${event.section} section.`;
    }
  });
}

setupStrudel().then(
  () => {
    boot();
    connect();
  },
  (error) => {
    // Without this the page renders nothing at all and says nothing about why,
    // which is indistinguishable from the visuals being broken.
    console.error('[shipping-floor] Strudel failed to initialize', error);
    const conn = $('conn');
    if (conn) {
      setText(conn, 'audio engine failed to load — see console');
      setFlag(conn, 'connected', false);
    }
    boot();
    connect();
  },
);
