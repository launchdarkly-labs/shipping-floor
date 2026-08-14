---
description: Start a guarded rollout of a candidate variation on the rule that already serves its baseline
---

# Start the guarded rollout

## Before you start — check these or the rollout will stall

1. **Is a burn-in running?** A rollout step that is short of data does not
   fail, it *waits* — and then may roll back for failing the minimum-context
   requirement regardless of the guardrail. Live browser traffic is roughly
   eleven generations a minute across the whole band, and a rollout on one
   targeting rule sees only that rule's share of it.
2. **Is the burn-in pinned to the right rule?** `--state
   section=lift,energy=high,isBoundary=false` puts 100% of takes on the rule
   under test. Without it you may be generating thousands of contexts that
   never touch the arm you are measuring.
3. **Is there already a rollout on this config?** One at a time. The factory
   queue is serial per musician.

## Steps

Use `start-guarded-rollout` with:

- `flagKey` — an AgentControl config is flag-backed, so this is the config key
- `controlVariationId` / `testVariationId` — the `_id` UUIDs from
  `get-agentcontrol-config-targeting`, **not** the variation keys
- `randomizationUnit` — `request`, one coin flip per generation
- `stages` — custom `[{rolloutWeight, monitoringWindowMilliseconds}]`. Burn-in
  removes the data blocker; only short stages compress the *schedule*. These
  are two different things and conflating them is why a rollout looks stuck.
- per-metric `onRegression: { notify: true, rollback: true }` on
  `ceiling-breach-rate`

Put the rollout **on the targeting rule that already serves the baseline**, so
the comparison is a candidate against its own control. A rollout that pits one
groove against a different groove is measuring two musical intentions against
each other and means nothing.

## What to tell the user, and how to say it

Report the mechanism, never a timeline. Detection under sequential testing is
nondeterministic: write "when LaunchDarkly detects the regression", never
"after about four minutes".

Likewise, do not claim audible flag-delivery latency. Recovery is heard within
one regeneration interval — roughly sixteen seconds — and that delay is the
*regeneration schedule*, not flag delivery. The correct and still-impressive
claim is: you never restarted the server, never redeployed, and the change was
live on the next request.

## If you need to stop it

`stop-guarded-rollout`. Rehearse this path before any demo — it is the escape
hatch when the room is watching.
