---
description: Classify a proposed change — snippet-edit, new-variation, or new-groove — and say what LaunchDarkly shape it needs
---

# Classify a proposed change

Look at the change the user is proposing (a diff, a described prompt tweak, or
a new musical idea) and decide which of three shapes it takes. Then say what
must exist in LaunchDarkly before it can ship.

## The three shapes

| Shape | What it is | LaunchDarkly unit |
|---|---|---|
| **snippet-edit** | The wording of existing vocabulary changes — a tightened rule, a corrected gain, a clearer instruction | New snippet **version** + a **new variation** pinning it |
| **new-variation** | Same vocabulary, different composition — a different persona paired with the same groove, different parameters | New **variation** on the existing config |
| **new-groove** | Genuinely new musical vocabulary that did not exist before | New **snippet** + new **variation** + a **targeting rule** that serves it |

## Rules that are not negotiable

1. **Never bump a live variation's pinned snippet version in place.** Snippet
   updates are blocked during an active rollout, and bumping would destroy the
   control arm of the comparison anyway. Always clone to a new variation.
2. **A guarded rollout compares a candidate against its own baseline.** If the
   proposal would have you roll out `breakbeat-chopping` against
   `four-on-the-floor`, stop — those are two different musical intentions, and
   the metric difference between them means nothing. That is an arrangement
   change, which is targeting, not a release.
3. **Editing a snippet changes nothing in production** until a variation pins
   the new version. Say this out loud every time; it is the single most common
   way a reader concludes the tutorial is broken.

## What to do

1. Read the proposed change.
2. Name the shape and say why.
3. List the LaunchDarkly resources needed, in order.
4. Name the guardrail metric that would catch this change going wrong, and say
   what "going wrong" would sound like.
5. Stop. Do not create anything — `/factory-flag` does that, after a human has
   agreed with your classification.

## A note on what this step is

This is the weakest of the five primitives here, and it should be labelled as
replaceable scaffolding rather than dressed up. There is no diff-analysis
agent in this repo, and building one would be a second product. What is real
is that an agent did the classify-and-flag step at all — the rails underneath
do not care who or what invoked them.
