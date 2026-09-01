# Shipping Floor

**An agentic software factory you can hear.**

Three AI agents — a **drummer**, a **bassist**, and a **keys player** — perform
generative electronic music live in your browser, one layer each, played by
[Strudel](https://strudel.cc). A plain-code **conductor** keeps tempo, key, and
song structure. Every few bars each agent asks a small model for the next
version of its part.

The point is not the music. The point is what the loop already was:

```
generate → gate → deploy → roll back
```

An agent produces an artifact (a Strudel pattern — that *is* code). A lint
gates it. The browser's real parser gates it again. It deploys at the next
cycle boundary. On failure the previous pattern keeps looping. That is a
factory running eleven times a minute that nobody called a factory — and until
now, it was **completely unmeasured**.

Its gate caught syntax but not taste. It could not catch a pattern that parses
perfectly and is 12 dB too loud. That gap is what this repo is about, and you
can hear it close in about ten seconds.

> **You already built a factory. What you were missing was rails.**

## The claim, stated plainly

**The application contains no music.** Not a groove rule, not a synth recipe,
not a gain ceiling. Every word of every agent's musical vocabulary is a
versioned [prompt snippet](https://launchdarkly.com/docs/home/agentcontrol/snippets)
in LaunchDarkly, composed server-side into an AgentControl config variation.

Which vocabulary an agent gets is **a targeting decision**, not a decision this
code makes and no longer a decision the model makes either. Changing the
arrangement means editing a targeting rule.

Changes to that vocabulary ship through **guarded rollouts** with a
deterministic guardrail metric and automatic rollback.

If LaunchDarkly is unreachable, the band holds and then falls silent. There is
no local fallback, deliberately — a hidden default would make the whole claim a
lie.

## Quickstart

```bash
npm install
cp .env.example .env        # ANTHROPIC_API_KEY, SDK key, LAUNCHDARKLY_PROJECT_KEY
npm run seed                # print every LaunchDarkly resource this app needs
#   /factory-bootstrap in a new project (LAUNCHDARKLY_PROJECT_KEY).
#   Kinds appear from --verify. Tick Available for experiments on
#   request before metrics. Do not start at Add kind.
npm run seed -- --verify    # check what LaunchDarkly actually serves back
npm start
```

Open http://localhost:3000 and press **Play**.

`npm start` runs a preflight check and refuses to start if LaunchDarkly is not
delivering usable configs. A band that plays silence for reasons nobody can see
is the worst possible failure mode, so this one is loud.

## Set up the LaunchDarkly project

`npm run seed` prints every resource this app expects and validates the local
seed material. It creates nothing. A write-scoped API token does not belong in
this repo. Drive creation from the LaunchDarkly UI, or from the
`.claude/commands/factory-*` slash commands over the LaunchDarkly MCP server,
which uses OAuth.

The fast path for a first run is a **new** project whose key is in
`LAUNCHDARKLY_PROJECT_KEY`, then `/factory-bootstrap`. That command
creates snippets, configs, targeting, and `strict-mix-gate` first. It
creates metrics only after `request` is an experiment unit. Later prompt
or flag changes still go through `/factory-classify` and a human.

Work through the groups the seed output prints, in order.

**1. Context kinds.** Do not start at **Add kind**. It is admin-only.
Features → Contexts is the instance list. An SDK evaluation
(`npm run seed -- --verify` or the app) creates `musician`,
`performance`, `listener`, and `request`. Then tick **Available for
experiments and guarded rollouts** on `request` before you create
metrics. The other three kinds do not need that checkbox for this
rollout.

**2. Prompt snippets.** All 17, each at version 1: three personas, three mix
disciplines, and eleven vocabularies. The bodies are the files in
`seed/snippets/`.

**3. Configs and variations.** Three configs (`drummer`, `bassist`, `keys`) and
11 variations between them. Each variation composes exactly three snippet
references, in this order: persona, mix discipline, then one vocabulary. The
order matters, because the mix discipline holds the gain ceiling and the ratchet
and has to sit above the vocabulary that could contradict it. Every variation's
parameters must include `gain_ceiling`; one without it silently disables the
guardrail for everyone it serves.

**4. Targeting rules.** First match wins, and the seed output prints the exact
clauses per config. The fallthrough is a percentage rollout across groove
variations rather than a single variation, which is what restores the variety
that deterministic targeting costs you.

**5. Metrics.** Three of them: `peak-gain` (numeric, lower is better),
`ceiling-breach-rate` (conversion, lower is better), and
`publish-success-rate` (conversion, higher is better). Create them only
after `request` is an experiment unit, and set the analysis unit to
`request` on all three. Creating them without that field defaults the
unit to `user`. There is no MCP `update-metric` tool.

**6. Flags.** Create the boolean flag `strict-mix-gate`. `create-flag`
defaults the on-variation to `true`; set the fallthrough to `false`, then
turn it **ON**. Do not start a rollout until the band is playing, and do
not burn in until the rollout is live.

Then check what LaunchDarkly actually serves back:

```bash
npm run seed -- --verify
```

This evaluates every config through the SDK and catches the two failures that
are otherwise completely silent: an empty `variationKey`, meaning LaunchDarkly
served the SDK's own fallback and is not driving the app at all, and a residual
`{{`, meaning a snippet reference did not resolve. An unresolved reference
renders to the empty string, so a prompt can lose an entire section with no
error anywhere.

Two failure modes worth recognizing, because their symptoms mislead:

- `Unknown feature flag "drummer"` from the SDK means the SDK key belongs to a
  **different project**, not that a config is off. The preflight reports it as
  "toggled off", which sends you looking for the wrong thing.
- A config that is enabled but has **no targeting rules** falls through to the
  `disabled` variation and starts into nothing. Check the environment you are
  pointing at, not just the project.

## Things to try while it plays

```bash
# Change a targeting rule in LaunchDarkly → hear the style change at the next
# section boundary → find your name in the change history.

# Serve a different audience a different shelf of vocabulary:
DEMO_AUDIENCE=lounge npm start

# Ask LaunchDarkly which rule matched (costs a second eval event per generation):
LD_EXPLAIN=1 npm start

# Generate volume for a rollout, pinned to one targeting rule:
npm run burn-in -- --state section=lift,energy=high,isBoundary=false --generations 500
```

**Editing a snippet changes nothing** until a variation pins the new version.
This trips up everyone once. It is also exactly what makes a prompt change a
discrete, reviewable, shippable unit.

## What you see

- **Production line** (top) — six stages in two groups with a seam:
  `Generate ‖ Classify · Flag · Measure · Release · Clean up`. Everything left
  of the seam you already had. Everything right of it is the part that was
  missing.
- **Agent rack** — three peers, one expanded. Each row shows the served
  variation, peak gain against the ceiling, and a mini gain meter.
- **Control Tower** — for the selected agent: what is being served and why,
  which snippets composed its prompt (with pinned versions), live guardrail
  meters, and rollout state.
- **Canvas** — each agent owns a band, a colour, *and* a distinct mark form, so
  identity survives greyscale and a bad projector.

Press `1` / `2` / `3` for showroom, factory, and burn-in layouts.

Every fact lives in the DOM; the canvas only dramatises. Turning it off loses
no information — which is what makes "no quality gate is audio-only" an
achievable rule rather than a good intention.

## How it works

```
LaunchDarkly AgentControl config variation
  = persona snippet + mix-discipline snippet + exactly ONE vocabulary snippet
  + model, parameters, and gain_ceiling
        │
        │  selected by TARGETING, keyed on a multi-context:
        │    musician    — which agent
        │    performance — section, energy, isBoundary
        │    listener    — audience
        │    request     — one generation  ← THE RANDOMIZATION UNIT
        ▼
┌─ Musician ──────────────────────────────────────────────┐
│  generate (1 call) → lint + gain gate → publish → hold   │
│  peak-gain and ceiling-breach-rate go back to LaunchDarkly│
└─────────────────────────┬───────────────────────────────┘
        Conductor (plain code): tempo, key, sections,
        staggered regeneration, settle-off-the-moment
                          │ websocket: snapshots + events
                          ▼
┌─ Browser player (public/) ──────────────────────────────┐
│  @strudel/web validates each pattern with Strudel's own │
│  evaluator and swaps layers at the next cycle boundary  │
└─────────────────────────────────────────────────────────┘
```

### The guardrail is deterministic, and audio-free by design

`maxGain()` in `src/validate.js` reads the peak gain a pattern asks for,
straight from the pattern string, with no audio. That constraint is what makes
the headless burn-in able to produce the same metric as the browser — *your
laptop is one listener, the burn-in is the other ten thousand*, and both write
to the same environment.

Reading it correctly is fiddlier than it looks. A naive
`/\.gain\((\d+\.?\d*)\)/` reads the `*4` repeat multiplier in
`.gain("[.2 .38]*4")` as a gain of **4.0** — flagging every legitimate pattern
in the repo and causing constant false rollbacks. Mini-notation operators are
stripped before any number is read, `.range(a,b)` takes its ceiling, and
anything unrecognised is **skipped rather than failed closed**.

Be honest about what the metric is: `ceiling-breach-rate` is a **policy**
metric — did the output obey a documented invariant — not a quality metric.
That is a stronger claim, and unlike a quality score it is true.

### Two detectors

> Your ear caught the bad kick in five seconds and it will never do that again
> — not at 3am, not at 0.5% of traffic, not for a 2% degradation, not for the
> other 400 changes shipping today. Sequential testing caught it in five
> minutes and it will catch it every time, forever, without you.
>
> **The factory's job is to replace the ear.**

Audibility is scaffolding, not the value proposition. That is why the headless
burn-in is the thesis rather than a footnote.

## Repo tour

```
seed/                    what must exist in LaunchDarkly, as reviewable data
  snippets/              17 snippets: 3 personas, 3 mix disciplines, 11 vocabularies
  configs.json           variations, targeting rules, metrics, gain ceilings
src/server.js            http + websocket entrypoint, preflight check (npm start)
src/conductor.js         tempo/key/section scheduler, settle-off-the-moment
src/musician.js          the agent loop: generate → gate → publish → hold
src/config/launchdarkly.js  multi-context, snippet recovery, ceiling destructure
src/validate.js          the lint and maxGain() — the deterministic guardrail
src/stage.js             websocket bridge: rev-stamped snapshots + event stream
public/                  the player and HUD, ~10 ES modules, no build step
scripts/seed.js          validate seed/ and print the LaunchDarkly setup
scripts/burn-in.js       headless volume for a rollout, with a hard cost cap
.claude/commands/        the five factory steps over the LaunchDarkly MCP server
test/                    maxGain regression tests + conductor settle tests
```

### Why seed/ exists when nothing reads it

`seed/` is not read at runtime. The running band gets every word of its
vocabulary from LaunchDarkly, so deleting the directory mid-performance would
change nothing. It exists so a prompt change is a diff someone reviews in a pull
request rather than an edit made in a web UI at 11pm, and so `npm run seed` can
validate the material against itself before you spend a click: every referenced
snippet exists, targeting never serves an undeclared variation, rollout weights
total 100, and no piece of vocabulary asks for more gain than the ceiling about
to be enforced against it.

`npm test` runs both suites. The most important test asserts that **no piece of
vocabulary breaches its own musician's ceiling** — because a guardrail that
rejects legitimate output is a guardrail somebody switches off. (It caught a
real one: the bassist's `sub-drop` asks for `.gain(.9)`, so the bassist ceiling
is 0.9, not the 0.85 it was first written as.)

## Costs

One model call per regeneration per agent, roughly every 8 cycles (~16 s), each
a few hundred tokens — the model is whatever the served variation specifies.
Burn-in is metered separately: roughly **$1.50–3.50 per 1,000 generations**,
with a hard `--generations` cap, a `--budget` flag, and an estimate you must
confirm. Prompt caching does not help here — the assembled prompt is well under
the minimum cacheable prefix, so `cache_control` would silently no-op.

## Licensing & credits

- This repo's code is [MIT](LICENSE).
- [Strudel](https://codeberg.org/uzu/strudel) is AGPL-3.0 and is loaded by the
  browser page as its own package from a CDN — never vendored, forked, or
  imported by the Node code, which only ever sends pattern strings to it.
- The Strudel pattern reference woven into the vocabulary snippets draws on the
  official [Strudel documentation](https://strudel.cc/learn) and on
  [calvinw/strudel-llm-docs](https://github.com/calvinw/strudel-llm-docs).
- Model, parameters, prompts, and all musical vocabulary are delivered by
  [LaunchDarkly](https://launchdarkly.com/docs/home/agentcontrol).
