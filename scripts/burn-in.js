import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { Musician } from '../src/musician.js';
import { createConfigProvider } from '../src/config/index.js';

/**
 * Burn-in: run generations headlessly, at bounded concurrency, with no audio.
 *
 * Your laptop is one listener. The burn-in is the other ten thousand. Both
 * write to the same environment and the same metrics — they are two slices of
 * the same production traffic, not a test environment and a real one.
 *
 * This exists because ten minutes of listening proves nothing. A guarded
 * rollout needs enough contexts to reach a verdict, and the browser produces
 * about eleven generations a minute across the whole band.
 *
 * FIVE THINGS TO BE HONEST ABOUT, all of them load-bearing:
 *
 *  1. Rollout steps are TIME-based, not traffic-based. A minimum sample size
 *     only EXTENDS a step that is short of data (and can trigger a rollback).
 *     So burn-in REMOVES THE BLOCKER; IT DOES NOT ACCELERATE THE SCHEDULE.
 *     Compressing the schedule needs custom short `stages` on the rollout.
 *  2. A rollout on a targeting RULE only ever sees that rule's traffic. The
 *     `section=lift` rule fires on maybe a quarter of drummer regenerations —
 *     about one a minute live, so 500 takes is eight hours.
 *  3. Which is why --state exists. Pinning the synthetic conductor state
 *     lands 100% of takes on the rule under test.
 *  4. It costs real money. Roughly $1.50–3.50 per 1,000 generations — treat
 *     that as a range and measure your own. There is a hard --generations cap
 *     and a --budget, and an estimate you must confirm, because a public
 *     tutorial must not let a reader burn $100 on a typo'd loop.
 *  5. Prompt caching will not help. The assembled prompt is roughly
 *     750–1,100 tokens, below Haiku's 4,096-token minimum cacheable prefix,
 *     so cache_control would silently no-op.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Rough per-1k-generation cost band for a Haiku-class model at this size. */
const COST_PER_1K_LOW = 1.5;
const COST_PER_1K_HIGH = 3.5;

const CONCURRENCY_CAP = 8;
const GENERATION_CAP = 5000;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(join(ROOT, 'band.config.json'), 'utf8'));

  if (options.help) {
    usage();
    return;
  }

  const state = buildState(config, options.state);
  const musicians = options.musicians ?? Object.keys(config.musicians);

  console.log('\n  Burn-in');
  console.log('  ───────');
  console.log(`  musicians:   ${musicians.join(', ')}`);
  console.log(`  generations: ${options.generations}`);
  console.log(`  concurrency: ${options.concurrency}`);
  console.log(`  pinned state: section=${state.section} energy=${state.energy} isBoundary=${state.isBoundary} audience=${options.audience}`);

  const low = ((options.generations / 1000) * COST_PER_1K_LOW).toFixed(2);
  const high = ((options.generations / 1000) * COST_PER_1K_HIGH).toFixed(2);
  console.log(`\n  Estimated cost: $${low}–$${high} for ${options.generations} generations.`);
  if (options.budget != null && Number(high) > options.budget) {
    console.error(`  ✗ That exceeds your --budget of $${options.budget}. Lower --generations or raise --budget.\n`);
    process.exit(1);
  }
  if (!options.yes && !(await confirm())) {
    console.log('  Cancelled.\n');
    return;
  }

  const configProvider = createConfigProvider();
  const tally = new Tally();
  const started = Date.now();
  let issued = 0;
  let completed = 0;

  /**
   * EACH WORKER GETS ITS OWN BAND. This is not tidiness — it is the whole
   * reason concurrency works.
   *
   * A Musician drops a regenerate() call outright while one is already in
   * flight (the `busy` guard, which is correct on stage: the conductor should
   * never queue up a backlog of stale briefs). Share one instance across N
   * workers and N-1 of them no-op instantly, the loop spins through the
   * generation budget in seconds, and you get a run that reports "50
   * generations" having actually called the model once.
   *
   * That failure is quiet and it is expensive: it looks like a fast burn-in
   * while producing no contexts, so the rollout it was meant to feed stalls
   * for want of data.
   */
  const bands = Array.from({ length: options.concurrency }, () =>
    new Map(
      musicians.map((name) => [
        name,
        new Musician({
          name,
          configProvider,
          audience: options.audience,
          publish: async () => ({ ok: true }), // no browser: lint is the only gate
          onEvent: (entry) => tally.record(entry),
        }),
      ]),
    ),
  );

  /** One worker pulls takes until the budget of generations is exhausted. */
  async function worker(band) {
    while (issued < options.generations) {
      const mine = issued;
      issued += 1;
      const name = musicians[mine % musicians.length];
      await band.get(name).regenerate(state);
      completed += 1;
      if (completed % 25 === 0) progress(completed, options.generations, started);
    }
  }

  await Promise.all(bands.map(worker));

  // Flush before exit or the trailing events simply vanish, and the last
  // minute of a burn-in is exactly the part you were waiting for.
  await configProvider.close();

  report(tally.rows, started, completed);
}

/**
 * Tallies by served variation — which is the only grouping a rollout cares
 * about, since the whole question is "did the treatment arm behave worse than
 * the control arm".
 *
 * Attribution needs care: only the `config` and `pattern` events carry a
 * variationKey. A lint rejection or a hold does not, so the variation most
 * recently served to THAT musician is remembered and rejections are charged
 * to it. Without this, every rejection — the most interesting signal in a
 * bad rollout — would land in an "unknown" bucket.
 */
class Tally {
  constructor() {
    this.rows = new Map();
  }

  #row(key) {
    if (!this.rows.has(key)) {
      this.rows.set(key, { generated: 0, published: 0, rejected: 0, breaches: 0, held: 0, gains: [] });
    }
    return this.rows.get(key);
  }

  record(entry) {
    // Every event carries its own variation, so attribution never depends on
    // remembering which arm a musician was last on. That matters here: each
    // worker runs its OWN Musician instances, so several may share a name
    // while sitting on different arms of a rollout at the same moment.
    const key = entry.variationKey || 'SDK DEFAULT (LaunchDarkly not driving this)';
    if (entry.event === 'config') {
      this.#row(key).generated += 1;
      return;
    }
    if (!entry.variationKey) return;
    const row = this.#row(key);

    switch (entry.event) {
      case 'pattern':
        row.published += 1;
        if (entry.gain != null) row.gains.push(entry.gain);
        break;
      case 'lint-rejected':
        row.rejected += 1;
        if (entry.ceilingExceeded) row.breaches += 1;
        break;
      case 'parse-rejected':
        row.rejected += 1;
        break;
      case 'kept-previous':
        row.held += 1;
        break;
    }
  }
}

function progress(done, total, started) {
  const rate = done / ((Date.now() - started) / 1000 / 60);
  process.stdout.write(`\r  ${done}/${total} generations · ${rate.toFixed(0)}/min   `);
}

function report(results, started, completed) {
  const minutes = (Date.now() - started) / 1000 / 60;
  console.log('\n\n  Per-variation summary');
  console.log('  ─────────────────────');

  const summary = {};
  for (const [variation, row] of [...results].sort()) {
    const mean = row.gains.length ? row.gains.reduce((a, b) => a + b, 0) / row.gains.length : null;
    const peak = row.gains.length ? Math.max(...row.gains) : null;
    // Breaches are counted per ATTEMPT and generations per TURN, and a turn
    // runs up to two attempts. Dividing one by the other produced rates above
    // 100% — which is not a rounding wart, it is a different denominator.
    const attempts = row.published + row.rejected;
    summary[variation] = {
      generated: row.generated,
      attempts,
      published: row.published,
      rejected: row.rejected,
      ceilingBreaches: row.breaches,
      held: row.held,
      breachRatePerAttempt: attempts ? row.breaches / attempts : 0,
      publishSuccessRate: row.generated ? row.published / row.generated : 0,
      meanPeakGain: mean,
      maxPeakGain: peak,
    };
    const s = summary[variation];
    console.log(`\n  ${variation}`);
    console.log(`    generated ${row.generated}  attempts ${attempts}  published ${row.published}  rejected ${row.rejected}  held ${row.held}`);
    console.log(`    ceiling breaches ${row.breaches} (${(s.breachRatePerAttempt * 100).toFixed(1)}% of attempts)`);
    console.log(`    publish success ${(s.publishSuccessRate * 100).toFixed(1)}%  ← the guardrail for a code change`);
    console.log(`    peak gain — mean ${mean?.toFixed(3) ?? '—'}, max ${peak?.toFixed(3) ?? '—'}`);
  }

  console.log(`\n  ${completed} generations in ${minutes.toFixed(1)} min (${(completed / minutes).toFixed(0)}/min)\n`);
  console.log(JSON.stringify({ completed, minutes: Number(minutes.toFixed(2)), variations: summary }, null, 2));
}

function buildState(config, pinned) {
  // A synthetic conductor state. Real enough for the prompt, pinned so every
  // take lands on the same targeting rule.
  const section = config.sections.find((s) => s.name === pinned.section) ?? config.sections[0];
  return {
    key: config.key,
    scale: config.scale,
    cps: config.tempo.cps,
    cycle: 0,
    section: pinned.section ?? section.name,
    energy: pinned.energy ?? section.energy,
    isBoundary: pinned.isBoundary === 'true',
    cyclesLeftInSection: section.cycles,
    nextSection: { name: section.name, energy: section.energy },
    playing: true,
    bandMembers: Object.keys(config.musicians),
  };
}

function parseArgs(argv) {
  const out = {
    generations: 200,
    concurrency: 4,
    audience: process.env.DEMO_AUDIENCE || 'peak-hour',
    state: {},
    yes: false,
    budget: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    const consume = () => { if (inline === undefined) i += 1; };

    switch (flag) {
      case '--generations': out.generations = Number(value); consume(); break;
      case '--concurrency': out.concurrency = Number(value); consume(); break;
      case '--budget': out.budget = Number(value); consume(); break;
      case '--audience': out.audience = value; consume(); break;
      case '--musicians': out.musicians = value.split(','); consume(); break;
      case '--state':
        for (const pair of value.split(',')) {
          const [k, v] = pair.split('=');
          out.state[k] = v;
        }
        consume();
        break;
      case '--yes': out.yes = true; break;
      case '--help': case '-h': out.help = true; break;
    }
  }

  // Hard caps. The point of a cap is that it is not negotiable at 2am.
  out.generations = Math.min(Math.max(1, out.generations), GENERATION_CAP);
  out.concurrency = Math.min(Math.max(1, out.concurrency), CONCURRENCY_CAP);
  return out;
}

async function confirm() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('  Proceed? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function usage() {
  console.log(`
  npm run burn-in -- [options]

    --generations N     how many generations (default 200, hard cap ${GENERATION_CAP})
    --concurrency N     parallel workers (default 4, hard cap ${CONCURRENCY_CAP})
    --budget N          refuse to start if the high estimate exceeds $N
    --state k=v,k=v     pin the conductor state so every take lands on the
                        rule under test, e.g.
                        --state section=lift,energy=high,isBoundary=false
    --musicians a,b     only these musicians (default: all)
    --audience NAME     listener audience (default peak-hour)
    --yes               skip the cost confirmation

  A rollout on a targeting rule only sees that rule's traffic, so --state is
  usually the difference between 8 hours and 20 minutes.

  There is deliberately no --synthetic mode. A replay-only run exercises the
  rollout machinery while producing no information at all about whether a
  prompt is any good, and a flag that looks like a burn-in but cannot answer
  the burn-in's question is a trap — especially on stage. If you want the
  machinery exercised cheaply, run a small --generations against a variation
  you already understand.
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
