import test from 'node:test';
import assert from 'node:assert/strict';

import { maxGain, lintPattern } from '../src/validate.js';
import { loadSeedMaterial, codeBlocks } from '../src/seed-material.js';

/**
 * The guardrail metric is only worth anything if it does not fire on
 * legitimate output. These are the three argument forms that actually occur
 * in the vocabulary, plus the trap that motivated the whole function.
 */
test('maxGain reads the three real argument forms', () => {
  assert.equal(maxGain('.gain(1.15)'), 1.15, 'numeric literal');
  assert.equal(maxGain('.gain("[.18 .3 .22 .4]*4")'), 0.4, 'mini-notation string');
  assert.equal(maxGain('.gain(saw.range(.15,.48))'), 0.48, 'signal — take the range ceiling');
});

test('maxGain does not read mini-notation operators as levels', () => {
  // THE bug this function exists to avoid. A naive /\.gain\((\d+\.?\d*)\)/
  // reads the *4 repeat multiplier as a gain of 4.0 and flags every
  // legitimate pattern in the repo — constant false rollbacks.
  assert.equal(maxGain('.gain("[.2 .38]*4")'), 0.38, '*N repeat');
  assert.equal(maxGain('.gain("[.2 .38]/2")'), 0.38, '/N slow');
  assert.equal(maxGain('.gain("[.2 .38]!3")'), 0.38, '!N replicate');
  assert.equal(maxGain('.gain("[.2 .38]@4")'), 0.38, '@N elongate');
  assert.equal(maxGain('.gain(".3(3,8)")'), 0.3, '(3,8) euclid');
  assert.equal(maxGain('.gain(".3:2")'), 0.3, ':N sample index');
});

test('maxGain strips operators whose operand is itself a pattern', () => {
  // The same trap one level down: matching only a bare `*4` leaves the `[2 4]`
  // of `*[2 4]` behind, and the 4 is then read as a gain of 4.0 — a false
  // breach on a legal pattern, which would roll back a healthy rollout.
  assert.equal(maxGain('.gain("[.2 .38]*[2 4]")'), 0.38, '*[...] alternating count');
  assert.equal(maxGain('.gain("[.2 .38]*<2 4>")'), 0.38, '*<...> cycling count');
  assert.equal(maxGain('.gain("[.2 .38]/<2 4>")'), 0.38, '/<...> cycling slow');

  // And the full lint, since that is what actually gates a publish.
  const verdict = lintPattern('s("white").gain("[.2 .38]*[2 4]")', { gainCeiling: 1.0 });
  assert.equal(verdict.ok, true, 'a legal pattern must not be rejected');
  assert.equal(verdict.gain, 0.38);
});

test('maxGain takes the global max across a stack', () => {
  const stack = `stack(
    note("c1*4").s("sine").gain(1.1).dist(".3:.9"),
    s("white*8").hpf(9000).gain("[.2 .38]*4"),
    s("pink").struct("~ x ~ x").bpf(1200).gain(.75)
  )`;
  assert.equal(maxGain(stack), 1.1);
});

test('maxGain skips forms it does not model rather than guessing', () => {
  // Failing open is deliberate: a false rollback costs more than a missed
  // breach, and the browser parser and the ear are both still downstream.
  assert.equal(maxGain('.gain(sine)'), null, 'signal with no stated range');
  assert.equal(maxGain('s("white").hpf(9000)'), null, 'no gain call at all');
  assert.equal(maxGain('.gain('), null, 'unbalanced — no crash, no verdict');
});

test('maxGain ignores numbers in neighbouring controls', () => {
  // dist(".35:.85") and s("white(5,8)") both carry numbers that a sloppier
  // scan would pick up.
  assert.equal(maxGain('s("white(5,8)").dist(".35:.85").gain(.2)'), 0.2);
});

test('lintPattern enforces the ceiling and always reports the gain', () => {
  const legal = 'note("c1*4").s("sine").gain(1.1)';
  const loud = 'note("c1*4").s("sine").gain(1.4)';

  assert.deepEqual(lintPattern(legal, { gainCeiling: 1.15 }), { ok: true, gain: 1.1 });

  const verdict = lintPattern(loud, { gainCeiling: 1.15 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ceilingExceeded, true);
  assert.equal(verdict.gain, 1.4, 'the number is reported even on a rejection');

  // No ceiling delivered ⇒ no gain check. Never fail closed.
  assert.equal(lintPattern(loud, {}).ok, true);
});

test('strict-mix-gate swaps in the tighter ceiling only when the flag is on', () => {
  const pattern = 'note("c1*4").s("sine").gain(1.1)';
  const opts = { gainCeiling: 1.15, strictGainCeiling: 0.95 };

  assert.equal(lintPattern(pattern, { ...opts, strictMixGate: false }).ok, true);

  const strict = lintPattern(pattern, { ...opts, strictMixGate: true });
  assert.equal(strict.ok, false, 'the same pattern is now rejected');
  assert.match(strict.reason, /strict-mix-gate on/);
});

test('lintPattern still rejects side effects and sample loading', () => {
  assert.equal(lintPattern('samples("x"); s("bd")').ok, false);
  assert.equal(lintPattern('s("bd")').ok, false, 'bd is a sample, not a built-in synth');
  assert.equal(lintPattern('s("sine").gain(.5').ok, false, 'unbalanced parens');
});

/**
 * The regression test that matters: run the real ceiling against every gain
 * in the real vocabulary. A failure here means a musician would reject its
 * own vocabulary and hold — which is exactly the day-one blocker the
 * bassist's sub-drop presented at a 0.85 ceiling.
 */
test('no vocabulary example breaches its own musician\'s ceiling', async () => {
  const material = await loadSeedMaterial();
  let checked = 0;

  for (const variation of material.variations) {
    const ceiling = material.configs.musicians[variation.musician].gainCeiling;
    const vocabulary = material.snippets.get(variation.snippetRefs[2]);

    for (const { code, line } of codeBlocks(vocabulary)) {
      const gain = maxGain(code);
      if (gain == null) continue;
      checked += 1;
      assert.ok(
        gain <= ceiling,
        `${vocabulary.key}:${line} asks for gain ${gain}, above the ${ceiling} ceiling`,
      );
    }
  }

  assert.ok(checked > 20, `expected to check many examples, only saw ${checked}`);
});
