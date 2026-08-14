---
description: Create the snippet version and clone the variation that pins it
---

# Create the snippet version and the candidate variation

Run this after `/factory-classify` has named the shape and a human has agreed.

Use the LaunchDarkly MCP server for every mutation. Do not write a REST client
and do not ask for a `LAUNCHDARKLY_API_TOKEN` — MCP authenticates with OAuth,
so there is nothing to leak and nothing to rotate.

## Steps

1. **Read the current state first.**
   - `get-agentcontrol-config` for the config in question
   - `list-prompt-snippets` to see current keys and versions
   - `get-agentcontrol-config-targeting` to see which rule serves what, and to
     capture the variation `_id` UUIDs — the rollout tools need those, not the
     human-readable keys

2. **Create the new snippet version** with `create-prompt-snippet` (or the
   update call, which creates a version rather than overwriting). Snippets
   cannot reference other snippets, so the body must be self-contained.

3. **Clone the variation** with `clone-agentcontrol-config-variation`, then
   point the clone's snippet reference at the NEW version:
   `{{snippet.<key>#<newVersion>}}`.

   Name the clone after the change, not after a version number —
   `four-on-the-floor-louder-kick` reads better in a rollout dialog six weeks
   later than `four-on-the-floor-v2`.

4. **Add the second system message** to the clone, declaring its composition:

   ```
   snippets: drummer-persona#1, drummer-mix-discipline#1, drummer-four-on-the-floor#2
   ```

   LaunchDarkly strips snippet keys and versions when it inlines the text, so
   this declaration is the only way the running app can report which snippets
   composed its prompt. The config provider parses it and never sends it to
   the model.

5. **Copy the parameters across**, including `gain_ceiling` and
   `strict_gain_ceiling`. A variation without a ceiling silently disables the
   guardrail for whoever it is served to.

6. **Do NOT start a rollout.** Report what you created and stop.
   `/factory-release` is a separate, human-invoked step, and keeping it
   separate is the point.

## Verify before you report

Run `npm run seed -- --verify`. It evaluates every config through the SDK and
checks the two failures that are otherwise silent: an empty `variationKey`
(LaunchDarkly served the SDK default, so it is not driving the app at all) and
a residual `{{` in the assembled prompt (a snippet reference that resolved to
the empty string).
