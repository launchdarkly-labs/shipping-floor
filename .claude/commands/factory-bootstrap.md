---
description: Create every LaunchDarkly resource the seed lists so a reader can start at Play
---

# Bootstrap the factory from seed/

This is how a tutorial reader skips construction. It creates the resources in
`seed/configs.json` and `seed/snippets/` once, in a project the reader owns.
It is not how later changes ship. Those still go through `/factory-classify`
and a human.

Use the LaunchDarkly MCP server for every mutation. Do not write a REST
client and do not ask for a `LAUNCHDARKLY_API_TOKEN`. MCP authenticates with
OAuth.

Read `seed/configs.json` and `seed/snippets/` yourself. Do not invent keys,
bodies, parameters, or targeting clauses.

## Establish the target

1. Read `LAUNCHDARKLY_PROJECT_KEY` from `.env`, or ask for the key of the
   project the user just created. Use it for every MCP call. Never default
   to `shipping-floor`.
2. Stop if that project already contains `drummer`, `bassist`, or `keys`
   unless the user explicitly wants to reuse it.
3. Probe the connection with `list-projects`. An auth helper can report
   success while the API still returns `token_expired`; if that happens,
   tell the user to reconnect the server.
4. Run `npm run seed`. Treat its output as the specification. The
   `this run targets:` line must name the project from `.env`.

Cursor may pause production writes behind an approval card. Wait for the
user to approve, then retry the same operation.

## Phase 1: Create the foundation

Create these resources in order. Report a failure instead of substituting
another value.

1. **Snippets:** Create every file in `seed/snippets/` at version 1, with
   the body copied verbatim.
2. **Configs:** Create `drummer`, `bassist`, and `keys`, followed by every
   variation in the seed.
3. **Variation contents:** Preserve the system-message order of persona,
   mix discipline, then vocabulary. Include `gain_ceiling` and
   `strict_gain_ceiling` exactly as printed. Do not interchange
   `modelConfigKey` and `modelName`.
4. **Targeting:** Reproduce every first-match-wins rule and fallthrough
   from the seed. A new config serves nothing until its fallthrough points
   to a real variation or rollout.
5. **Flag:** Create the boolean `strict-mix-gate` flag. A new boolean flag
   serves `true` when on, so change the default rule to `false` before
   turning the flag **ON**. Do not start a guarded rollout.

## Pause: Register the request context

Do not create metrics until `request` exists and is marked **Available for
experiments and guarded rollouts**.

If `request` is not ready:

1. Ask the user to run `npm run seed -- --verify`. The SDK evaluations
   create `musician`, `performance`, `listener`, and `request`.
2. Wait for the command to exit 0.
3. Ask the user to open **Code → Contexts → gear**, edit `request`, and
   select **Available for experiments and guarded rollouts**.
4. Wait for the user to confirm the setting.

Do not send the user to **Add kind**. It is admin-only, and the Contexts
list shows instances rather than creating kinds. The context-kind API can
set the experiments field, but MCP has no context-kind tool.

## Phase 2: Create the metrics

After the user confirms that `request` is available, create:

- `peak-gain`
- `ceiling-breach-rate`
- `publish-success-rate`

Pass `randomizationUnits: ["request"]` for all three. If the API returns
`Randomization unit "request" not found`, stop and have the user fix the
context setting. Never omit the field: MCP otherwise defaults to `user`,
and it has no `update-metric` tool.

## Verify the result

Ask the user to run:

```bash
npm run seed -- --verify
```

That evaluates every config through the SDK and checks that
`strict-mix-gate` is serving `false`. It must reach
`stream.launchdarkly.com`; a sandbox DNS failure is not a seed bug. If it
fails, fix the missing resource. Do not tell them to start the app until
it exits 0.

## What you are not doing

- You are not editing application code. `strict-mix-gate` is already
  evaluated in `src/validate.js`.
- You are not starting a rollout. `/factory-release` does that after the
  band is playing. Burn-in runs **after** the rollout is live.
- You are not cleaning up. `/factory-cleanup` is a later, separate step.
