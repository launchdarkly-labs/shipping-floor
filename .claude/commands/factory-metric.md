---
description: Create or verify the guardrail metrics and their analysis units
---

# Create or verify the guardrail metrics

Three metrics, and deliberately no more. Everything else the app measures —
lint rejections, parse rejections, holds, retries — is a local Factory Ledger
counter on screen, not a LaunchDarkly metric. A rollout decision should rest
on a small number of things a reader can hold in their head.

| Metric | Kind | Direction | What it is for |
|---|---|---|---|
| `peak-gain` | numeric value | lower is better | The loudness number. The distribution matters, not just breaches |
| `ceiling-breach-rate` | conversion | lower is better | **The rollout guardrail** for a prompt change |
| `publish-success-rate` | conversion | higher is better | The guardrail for a **code** change — a too-strict gate does not sound bad, it makes the band freeze |

## Steps

1. `create-metric` for any that do not exist. The definitions live in
   `seed/configs.json` — read them from there rather than retyping.
2. **Set the analysis unit to `request` on all three.** This is the single
   most common place to get stuck: if a metric's analysis unit does not
   support the randomization unit the rollout uses, the context kind simply
   will not appear in the rollout dialog, with no explanation.
3. Confirm the `request` context kind has **"Available for experiments and
   guarded rollouts"** ticked.
4. Verify events are actually arriving with `list-metric-events` after a short
   `npm run burn-in -- --generations 50`.

## Be honest about what these measure

`ceiling-breach-rate` is a **policy** metric, not a quality metric. It answers
"did the output obey a documented invariant", not "did it sound good". Say so
whenever you present it. That is a stronger claim than a vague quality score,
and unlike a quality score it is actually true — which is also why the
guardrail is computable from the pattern string with no audio at all, and why
the headless burn-in can produce the same number as the browser.
