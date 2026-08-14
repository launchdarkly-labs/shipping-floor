import test from 'node:test';
import assert from 'node:assert/strict';

import { Conductor } from '../src/conductor.js';

const CPS = 0.5;
const CYCLE_MS = 1000 / CPS;

function makeConfig(overrides = {}) {
  return {
    tempo: { cps: CPS },
    key: 'A',
    scale: 'minor',
    regenerateEveryCycles: 8,
    settleAfterBoundaryCycles: 2,
    musicians: {
      drummer: { regenerateOffset: 0 },
      bassist: { regenerateOffset: 3 },
      keys: { regenerateOffset: 6 },
    },
    sections: [
      { name: 'intro', cycles: 4, energy: 'low', players: ['drummer', 'bassist', 'keys'] },
      { name: 'lift', cycles: 16, energy: 'high', players: ['drummer', 'bassist', 'keys'] },
    ],
    ...overrides,
  };
}

/** Run the conductor for `cycles` ticks, collecting every regenerate event. */
function run(t, config, cycles) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const conductor = new Conductor(config);
  const events = [];
  conductor.on('regenerate', ({ musician, state }) => {
    events.push({ cycle: conductor.cycle, musician, isBoundary: state.isBoundary, section: state.section });
  });
  conductor.start();
  t.mock.timers.tick(CYCLE_MS * cycles);
  conductor.stop();
  return events;
}

test('a section change re-briefs the whole band at the boundary', (t) => {
  const events = run(t, makeConfig(), 6);
  // intro is 4 cycles, so the boundary into `lift` lands on cycle 4.
  const atBoundary = events.filter((e) => e.cycle === 4);

  assert.equal(atBoundary.length, 3, 'all three musicians are re-briefed');
  assert.ok(atBoundary.every((e) => e.isBoundary === true), 'and told it is a boundary');
  assert.ok(atBoundary.every((e) => e.section === 'lift'), 'with the section they are ENTERING');
});

/**
 * The regression this exists to prevent: a moment variation describes a
 * ONE-CYCLE event, but patterns loop until replaced. Without a settle, the
 * next replacement is governed by the stagger — 6s for the bassist, 12s for
 * the keys, 16s for the drummer — so a one-bar fill repeats up to eight times.
 */
test('every musician is briefed back off the moment after settleAfterBoundaryCycles', (t) => {
  const events = run(t, makeConfig(), 8);
  const settle = events.filter((e) => e.cycle === 6); // boundary at 4, settle 2 later

  assert.equal(settle.length, 3, 'all three settle, not just the one whose stagger came due');
  assert.ok(settle.every((e) => e.isBoundary === false), 'and are told it is no longer a boundary');

  for (const musician of ['drummer', 'bassist', 'keys']) {
    const held = events.filter((e) => e.musician === musician && e.cycle > 4 && e.cycle <= 6);
    assert.equal(held.length, 1, `${musician} is re-briefed exactly once within 2 cycles of the boundary`);
  }
});

test('the settle interval is configurable', (t) => {
  // Boundary at cycle 4, so a 3-cycle settle lands on 7 rather than 6.
  const events = run(t, makeConfig({ settleAfterBoundaryCycles: 3 }), 9);

  const settle = events.filter((e) => e.cycle === 7);
  assert.equal(settle.length, 3, 'the whole band settles at cycle 7');
  assert.ok(settle.every((e) => e.isBoundary === false));

  // Cycle 6 has only the keys player's own stagger (offset 6), not a settle.
  const atSix = events.filter((e) => e.cycle === 6);
  assert.deepEqual(atSix.map((e) => e.musician), ['keys'], 'no band-wide settle at the old mark');
});

test('the opening brief also settles, so an opening moment does not loop', (t) => {
  const events = run(t, makeConfig(), 3);
  const opening = events.filter((e) => e.cycle === 0);
  const settle = events.filter((e) => e.cycle === 2);

  assert.equal(opening.length, 3, 'the show starts full');
  assert.ok(opening.every((e) => e.isBoundary === true));
  assert.equal(settle.length, 3, 'and settles off the opening moment two cycles later');
  assert.ok(settle.every((e) => e.isBoundary === false));
});

test('within a stable section musicians regenerate on their own stagger', (t) => {
  // Long opening section so nothing but the stagger fires.
  const config = makeConfig({
    sections: [{ name: 'groove', cycles: 64, energy: 'medium', players: ['drummer', 'bassist', 'keys'] }],
  });
  const events = run(t, config, 12);

  // Offsets 0/3/6 with regenerateEveryCycles 8 fire when (cycle - offset) % 8
  // is 0: bassist at 3 and 11, keys at 6, drummer at 8. Staggering them is
  // what stops all three spending tokens on the same cycle.
  const staggered = events.filter((e) => e.cycle > 2);
  assert.deepEqual(
    staggered.map((e) => `${e.cycle}:${e.musician}`),
    ['3:bassist', '6:keys', '8:drummer', '11:bassist'],
  );
  assert.ok(staggered.every((e) => e.isBoundary === false));
});
