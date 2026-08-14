/**
 * The three agents, in a FIXED order.
 *
 * This is load-bearing, not tidiness. Orbit (audio bus), analyser id, canvas
 * band, and colour are all derived from this index. The old code derived them
 * from Map insertion order — whatever order `Object.entries(message.layers)`
 * happened to yield — so the drummer could be teal in one tab and amber in
 * another, and could change colour across a reconnect. The entire premise of
 * the UI is that you can SEE which agent changed, so agent identity has to be
 * a constant, not an accident of iteration order.
 */
export const AGENTS = ['drummer', 'bassist', 'keys'];

export const agentIndex = (name) => AGENTS.indexOf(name);

/** Orbit and analyser share the index, 1-based: drummer 1, bassist 2, keys 3. */
export const agentBus = (name) => agentIndex(name) + 1;

export const $ = (id) => document.getElementById(id);

/**
 * Clone a <template> by id. Templates plus textContent replaced a pile of
 * innerHTML string-building, which was a live XSS path: snippet keys,
 * targeting rule descriptions, model names, and LLM-authored reason text all
 * flow into this UI, and `${info.configUrl}` was being interpolated straight
 * into an href.
 */
export function fromTemplate(id) {
  const template = $(id);
  if (!template) throw new Error(`missing <template id="${id}">`);
  return template.content.firstElementChild.cloneNode(true);
}

/** Write text only if it changed — every panel re-renders on every frame. */
export function setText(el, value) {
  if (!el) return;
  const text = value == null || value === '' ? '—' : String(value);
  if (el.textContent !== text) el.textContent = text;
}

/** Toggle a boolean state attribute without touching classList order. */
export function setFlag(el, name, on) {
  if (!el) return;
  if (el.hasAttribute(`data-${name}`) === Boolean(on)) return;
  if (on) el.setAttribute(`data-${name}`, '');
  else el.removeAttribute(`data-${name}`);
}

/**
 * Only ever produce an href we are willing to navigate to.
 *
 * The deep link to edit a config comes from the server, which builds it from
 * an env-configured base URL — so it is not attacker-controlled today. It is
 * validated anyway, because "not attacker-controlled today" is exactly the
 * property that quietly stops being true, and a javascript: URL in an href is
 * a one-line compromise.
 */
export function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Set an anchor's href safely, hiding the link entirely if the URL is not. */
export function setLink(el, value) {
  if (!el) return;
  const href = safeUrl(value);
  if (href) {
    el.href = href;
    el.hidden = false;
  } else {
    el.removeAttribute('href');
    el.hidden = true;
  }
}

/** A fixed-width number that never jitters as digits change. */
export function formatGain(value) {
  return value == null ? '—' : value.toFixed(2);
}
