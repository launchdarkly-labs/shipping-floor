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

## Before you create anything

1. Read the project key from `.env` (`LAUNCHDARKLY_PROJECT_KEY`) or ask the
   user for the key of the project they **just created**. Use that key
   everywhere. Do not default to `shipping-floor`. Do not write into a
   project that already has `drummer`, `bassist`, or `keys` configs unless
   the user confirms they want to reuse it.
2. Probe the MCP with `list-projects` before any write. A successful
   auth helper is not enough if the next call returns `token_expired`.
   In Cursor, production writes sit behind an approval card. Retry after
   the user approves. That is bootstrap, not a customer rollout.
3. Run `npm run seed` and keep that output. It is the spec. Create exactly
   what it prints. The line `seed default project: shipping-floor` is the
   seed file. The line `this run targets:` is the project you write to.

## Create, in this order

Report anything you could not create rather than substituting a value.

1. **Snippets.** `create-prompt-snippet` for every file in `seed/snippets/`,
   at version 1, body verbatim.
2. **Configs and variations.** `create-agentcontrol-config` for `drummer`,
   `bassist`, and `keys`. Then `create-agentcontrol-config-variation` for
   every variation the seed prints. Each variation's system message is the
   three snippet references in this order: persona, mix discipline,
   vocabulary. Parameters must include `gain_ceiling` and
   `strict_gain_ceiling` exactly as printed. Use the seed's `model` block
   as-is: `modelConfigKey` and `modelName` are not interchangeable.
3. **Targeting.** `update-agentcontrol-config-targeting` (or
   `update-targeting-rules`) so first-match-wins rules match the seed.
   Set each config's fallthrough to the variation or percentage rollout the
   seed names. A new config serves nothing until the fallthrough points at a
   real variation.
4. **Flag.** `create-flag` for `strict-mix-gate`, kind `boolean`. The
   default on-variation is `true`. `update-rollout` (or the equivalent
   fallthrough update) so the default rule serves `false`, then
   `toggle-flag` **ON**. Do not start a guarded rollout.
5. **Kinds, then metrics.** Do not create metrics yet unless `request`
   already exists and has **Available for experiments and guarded
   rollouts** ticked.

   Features → Contexts is the instance list and cannot create kinds.
   Kinds are **Code → Contexts → gear → Add kind** (often admin-only) or
   they appear after an SDK evaluation. The context-kind API can set the
   checkbox. MCP has no kind tool.

   If `request` is missing or the checkbox is off, **stop**. Ask the user
   to run `npm run seed -- --verify` (needs real network to
   `stream.launchdarkly.com`). That evaluation creates the kinds. Then
   they tick the checkbox on `request` in the UI. Creating AgentControl
   configs does **not** register `request` as an experiment unit.

   Only after that unit exists: `create-metric` for `peak-gain`,
   `ceiling-breach-rate`, and `publish-success-rate` with
   `randomizationUnits: ["request"]`. If the API says that unit is not
   found, stop and fix the kind. Do not create the metrics without the
   field. MCP defaults a missing field to `user`. There is no
   `update-metric` tool.

## Then verify

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
