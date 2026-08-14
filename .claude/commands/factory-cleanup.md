---
description: Archive the losing variation, re-key the winner, and recount coverage
---

# Clean up after a rollout

The step everyone skips, which is why coverage numbers rot. A variation that
won and a variation that lost look identical in the dashboard a month later.

## Steps

1. **Check readiness** with `check-removal-readiness` before removing
   anything. It tells you whether code still references the variation.
2. **Archive the loser** with `delete-agentcontrol-config-variation`. If the
   candidate won, the *old* variation is the loser — archiving the thing you
   just proved worse is the whole point.
3. **Re-key the winner** to the plain name if it was created with a
   change-descriptive name (`four-on-the-floor-louder-kick` →
   `four-on-the-floor`), so the next change starts from a clean baseline.
4. **Update the local seed material** — `seed/snippets/` and
   `seed/configs.json` — so the repo matches production. Run `npm run seed` to
   confirm it is still self-consistent, and `npm test` to confirm the new
   vocabulary still sits under its ceiling.
5. **Update `public/ui/reasons.js`** if you changed the targeting rules. The
   rule-index-to-English map is hand-maintained, because LaunchDarkly returns
   `{kind, ruleIndex, ruleId}` and never the rule's text. If you skip this the
   HUD will confidently show the wrong reason, which is worse than showing
   none.
6. **Recount coverage.** How many runtime decisions are now under runtime
   control, out of the roughly ten this app has? Say the number out loud and
   say what is still holding it down.

## On the coverage number

Do not claim 100%, and do not treat a low number as a failure. This app starts
at about 20% — two of roughly ten runtime decisions under LaunchDarkly's
control — and moving two or three more across takes real work. The honest
lesson is that what holds a system at 20% is *friction*, and the only way to
know how much friction is to have just paid it.
