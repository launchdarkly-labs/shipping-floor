/**
 * Node-side lint for generated Strudel pattern strings.
 *
 * This is deliberately NOT a Strudel parser — Strudel (AGPL) stays isolated
 * in the browser, which performs the real parse (try/catch around its own
 * evaluator) before an update ever reaches the speakers. This lint is the
 * first line of defense: it rejects obvious junk before we spend a
 * round-trip, and it enforces the repo's ground rules (no sample loading,
 * no side effects) regardless of what the model outputs.
 *
 * It also enforces the ONE musical invariant that is computable from the
 * pattern string alone, with no audio: the absolute gain ceiling. That
 * "no audio required" property is load-bearing — it is what makes the
 * headless burn-in able to produce the same guardrail metric as the browser.
 *
 * Returns { ok: true, gain } or { ok: false, reason, gain }.
 */

const BANNED = [
  'import', 'require', 'samples(', 'fetch', 'await', 'window.', 'document.',
  'eval(', 'Function', 'process', 'localStorage', 'XMLHttpRequest', ';',
];

// The only sounds that exist without loading sample packs (Strudel built-in
// synthesis). Anything else — "bd", "hh", drum-machine names — would parse
// fine but play silence, so reject it here and let the musician retry.
const SYNTH_SOUNDS = new Set([
  'sine', 'sin', 'sawtooth', 'saw', 'square', 'sqr', 'triangle', 'tri',
  'pulse', 'supersaw', 'white', 'pink', 'brown', 'crackle',
]);

/**
 * @param {string} code
 * @param {object} [opts]
 * @param {number} [opts.gainCeiling] - absolute max gain for this musician,
 *   delivered by LaunchDarkly in the config's model.parameters. Omitted
 *   ⇒ the gain check is skipped entirely (never fail closed).
 * @param {number} [opts.strictGainCeiling] - the tighter ceiling applied when
 *   the `strict-mix-gate` flag is on. Ignored unless `strictMixGate` is true.
 * @param {boolean} [opts.strictMixGate] - LaunchDarkly boolean flag. This is
 *   the code-change unit of the tutorial: same rails, different unit.
 */
export function lintPattern(code, { gainCeiling, strictGainCeiling, strictMixGate = false } = {}) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, reason: 'empty pattern', gain: null };
  }
  const trimmed = code.trim();

  if (trimmed.length > 2000) {
    return { ok: false, reason: 'pattern too long', gain: null };
  }
  for (const token of BANNED) {
    if (trimmed.includes(token)) {
      return { ok: false, reason: `banned token: ${token}`, gain: null };
    }
  }
  if (trimmed.includes('```')) {
    return { ok: false, reason: 'contains markdown fence', gain: null };
  }

  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    const opens = count(trimmed, open);
    const closes = count(trimmed, close);
    if (opens !== closes) {
      return { ok: false, reason: `unbalanced ${open}${close} (${opens} vs ${closes})`, gain: null };
    }
  }
  if (count(trimmed, '"') % 2 !== 0) {
    return { ok: false, reason: 'unbalanced double quotes', gain: null };
  }

  const badSound = findUnknownSound(trimmed);
  if (badSound) {
    return {
      ok: false,
      reason: `unknown sound "${badSound}" — only built-in synths exist (${[...SYNTH_SOUNDS].join(', ')})`,
      gain: null,
    };
  }

  // The mix-discipline invariant, measured. `gain` is reported on every
  // verdict (pass or fail) because it is the numeric guardrail metric —
  // a legal pattern's peak gain is just as interesting as an illegal one's.
  const gain = maxGain(trimmed);
  const ceiling = strictMixGate && strictGainCeiling != null ? strictGainCeiling : gainCeiling;
  if (ceiling != null && gain != null && gain > ceiling) {
    return {
      ok: false,
      reason: `gain ${gain} exceeds the ${ceiling} ceiling${strictMixGate ? ' (strict-mix-gate on)' : ''}`,
      gain,
      ceilingExceeded: true,
    };
  }

  return { ok: true, gain };
}

/**
 * The peak gain a pattern asks for, or null when nothing readable was found.
 *
 * A naive /\.gain\((\d+\.?\d*)\)/ is WRONG and dangerous: it reads the `*4`
 * repeat multiplier in `.gain("[.2 .38]*4")` as a gain of 4.0, which flags
 * every legitimate pattern in the repo as a violation — a guardrail that
 * fires constantly is a guardrail that gets switched off. Mini-notation
 * operators are stripped before any number is read.
 *
 * Three argument forms occur in practice:
 *   .gain(1.15)                   numeric literal
 *   .gain("[.18 .3 .22 .4]*4")    mini-notation string
 *   .gain(saw.range(.15,.48))     signal — take the range ceiling
 *
 * Anything else is SKIPPED, never treated as a violation. Failing open is
 * deliberate: a false rollback costs more than a missed breach, and the
 * browser's real parser plus the ear are still downstream.
 */
export function maxGain(code) {
  let peak = null;
  for (const arg of gainArguments(code)) {
    const value = readGainArgument(arg);
    if (value != null && (peak == null || value > peak)) peak = value;
  }
  return peak;
}

/** Every `.gain(...)` argument in the source, extracted with balanced parens. */
function gainArguments(code) {
  const args = [];
  const marker = /\.gain\s*\(/g;
  let match;
  while ((match = marker.exec(code)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    let inString = null;
    for (; i < code.length && depth > 0; i += 1) {
      const c = code[i];
      if (inString) {
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'") inString = c;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
    }
    if (depth === 0) args.push(code.slice(start, i - 1).trim());
  }
  return args;
}

function readGainArgument(arg) {
  // Signal with an explicit range: saw.range(.15,.48) → the ceiling is .48.
  const range = arg.match(/\.range\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  if (range) return toNumber(range[2]);

  // Bare numeric literal: .gain(1.15)
  if (/^[\d.]+$/.test(arg)) return toNumber(arg);

  // Mini-notation string: strip the operators that carry counts, not levels,
  // then take the largest remaining number.
  //
  // An operator's operand can itself be a pattern, not just a bare number:
  // `[.2 .38]*[2 4]` alternates the repeat count, and `*<2 4>` cycles it. Those
  // forms have to be stripped too — matching only `*4` leaves `[2 4]` behind,
  // and the 4 is then read as a gain of 4.0. That is the same false positive
  // this function exists to prevent, arriving through a slightly different door.
  const quoted = arg.match(/^["']([\s\S]*)["']$/);
  if (quoted) {
    const stripped = quoted[1]
      .replace(/\([^)]*\)/g, ' ')                            // (3,8) euclid
      .replace(/[*/!@]\s*(\[[^\]]*\]|<[^>]*>|[\d.]+)/g, ' ') // *N /N !N @N, operand bare or patterned
      .replace(/:\s*[\d.]+/g, ' ');                          // :N sample index
    const numbers = (stripped.match(/\d*\.?\d+/g) ?? []).map(toNumber).filter((n) => n != null);
    return numbers.length ? Math.max(...numbers) : null;
  }

  // A bare signal (`sine`, `perlin`) with no stated range, or anything else
  // we do not model. Skip it rather than guess.
  return null;
}

function toNumber(text) {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Check every s("...")/sound("...") argument: each word-like token inside the
 * mini-notation string must be a built-in synth sound.
 */
function findUnknownSound(code) {
  const calls = code.matchAll(/\b(?:s|sound)\s*\(\s*"([^"]*)"/g);
  for (const [, arg] of calls) {
    const words = arg.match(/[a-zA-Z_][a-zA-Z_]*/g) ?? [];
    for (const word of words) {
      if (!SYNTH_SOUNDS.has(word)) return word;
    }
  }
  return null;
}

/** Strip markdown fences and surrounding prose the model might add anyway. */
export function extractPattern(text) {
  let out = text.trim();
  const fenced = out.match(/```(?:\w*)?\s*([\s\S]*?)```/);
  if (fenced) out = fenced[1].trim();
  return out;
}

function count(str, char) {
  let n = 0;
  for (const c of str) if (c === char) n += 1;
  return n;
}
