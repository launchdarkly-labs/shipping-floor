import test from 'node:test';
import assert from 'node:assert/strict';

import { Musician } from '../src/musician.js';

/**
 * A musician wired to a config provider we control the timing of.
 *
 * The provider reports the config as DISABLED, which makes #regenerate return
 * before it ever reaches the model — so these tests exercise the busy/pending
 * bookkeeping without a network call, deterministically, and without spending
 * money if an ANTHROPIC_API_KEY happens to be present in the environment.
 */
function harness({ failOn = null } = {}) {
  const calls = [];
  const events = [];
  let release;
  let gate = null;

  const configProvider = {
    // Shaped like the real multi-context, because Musician reaches into
    // context.<kind>.key to report which contexts selected the variation. A
    // flat stand-in throws there, and regenerate would swallow it as an error
    // event — a green test that never reached the code it claims to cover.
    buildContext: (musician, state) => ({
      musician: { key: musician },
      performance: { key: state.section },
      listener: { key: state.audience },
      request: { key: `req-${calls.length}` },
    }),
    async getMusicianConfig(name, context) {
      calls.push(name);
      if (gate) await gate;
      if (failOn && context.performance.key === failOn) throw new Error(`boom on ${failOn}`);
      return {
        enabled: false,
        valid: false,
        invalidReason: 'disabled for test',
        source: 'test',
        configKey: name,
        model: { name: null, parameters: {} },
        systemBase: '',
        snippets: [],
        variationKey: '',
        createTracker: () => ({ async trackMetricsOf(_e, call) { return call(); }, trackFeedback() {} }),
      };
    },
    async track() {},
    async boolFlag() { return false; },
  };

  const musician = new Musician({
    name: 'drummer',
    configProvider,
    publish: async () => ({ ok: true }),
    onEvent: (entry) => events.push(entry),
  });

  return {
    musician,
    calls,
    events,
    /** Fail loudly on a swallowed throw — regenerate turns those into events. */
    assertNoErrors() {
      const errors = events.filter((e) => e.event === 'error');
      assert.deepEqual(errors, [], 'no turn should have thrown');
    },
    stall() { gate = new Promise((resolve) => { release = resolve; }); },
    resume() { gate = null; release(); },
  };
}

const briefing = (section) => ({
  key: 'A', scale: 'minor', cps: 0.5, cycle: 0,
  section, energy: 'medium', isBoundary: false, cyclesLeftInSection: 8,
  nextSection: { name: 'lift', energy: 'high' }, playing: true,
});

/**
 * The regression this exists to prevent.
 *
 * The conductor fires the settle brief on a fixed cycle — two cycles, 4s at
 * cps 0.5. A boundary turn is a model call plus a wait for the next cycle
 * boundary, and doubles on a lint retry. Whenever it ran long, the settle brief
 * was dropped, nothing re-armed it, and the musician looped its one-cycle fill
 * until its own stagger came due: up to 16 cycles of a figure meant to be heard
 * once. The conductor tests cannot catch this — they assert what the conductor
 * EMITS, never what a busy musician does with it.
 */
test('a brief that arrives mid-generation is applied, not dropped', async () => {
  const h = harness();

  h.stall();
  const first = h.musician.regenerate(briefing('boundary'));
  assert.equal(h.musician.busy, true, 'first brief is in flight');

  await h.musician.regenerate(briefing('settle'));
  assert.equal(h.musician.pending?.section, 'settle', 'the settle brief is retained');
  assert.deepEqual(h.calls, ['drummer'], 'and has not run yet');

  h.resume();
  await first;

  assert.deepEqual(h.calls, ['drummer', 'drummer'], 'the settle brief ran once the musician came free');
  assert.equal(h.musician.pending, null, 'pending is consumed');
  assert.equal(h.musician.busy, false, 'and the musician is free again');
  h.assertNoErrors();
});

test('only the newest brief is retained while busy', async () => {
  const h = harness();

  h.stall();
  const first = h.musician.regenerate(briefing('boundary'));
  await h.musician.regenerate(briefing('one'));
  await h.musician.regenerate(briefing('two'));
  await h.musician.regenerate(briefing('three'));

  // Coalesce, don't queue: each brief is a snapshot of a moving present, so a
  // backlog would replay stale musical state. The newest is the only one worth
  // running when the musician comes free.
  assert.equal(h.musician.pending.section, 'three');

  h.resume();
  await first;
  assert.equal(h.calls.length, 2, 'three queued briefs collapse to one run');
  h.assertNoErrors();
});

test('an idle musician runs a brief immediately', async () => {
  const h = harness();
  await h.musician.regenerate(briefing('groove'));
  assert.deepEqual(h.calls, ['drummer']);
  assert.equal(h.musician.busy, false);
  assert.equal(h.musician.pending, null);
  h.assertNoErrors();
});

/**
 * A turn that throws must cost that turn and nothing else.
 *
 * With the catch outside the drain loop, one bad turn exits the loop and takes
 * the queued brief with it — the same dropped-brief failure, reached through a
 * different door. This is the test that caught that.
 */
test('a turn that throws does not take the pending brief down with it', async () => {
  const h = harness({ failOn: 'boundary' });

  h.stall();
  const first = h.musician.regenerate(briefing('boundary'));
  await h.musician.regenerate(briefing('settle'));

  h.resume();
  await first;

  assert.equal(h.calls.length, 2, 'the settle brief still ran after the failed turn');
  assert.equal(h.events.filter((e) => e.event === 'error').length, 1, 'the failure was reported, once');
  assert.equal(h.musician.busy, false, 'and the musician did not wedge');
  assert.equal(h.musician.pending, null);
});
