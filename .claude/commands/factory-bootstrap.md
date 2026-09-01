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

1. Confirm the project key. Default is `shipping-floor`. If the user named
   their project something else, use that key everywhere.
2. Confirm the four context kinds exist **in the UI**: `musician`,
   `performance`, `listener`, and `request`. Each must have **Available for
   experiments and guarded rollouts** ticked. The context-kind API cannot set
   that checkbox. If any kind is missing, stop and tell the user to create it
   before you continue.
3. Run `npm run seed` and keep that output. It is the spec. Create exactly
   what it prints.

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
4. **Metrics.** `create-metric` for `peak-gain`, `ceiling-breach-rate`, and
   `publish-success-rate`. Set the analysis unit to `request` on all three.
   If that unit does not match the rollout's randomization unit, the kind
   never appears in the rollout dialog.
5. **Flag.** `create-flag` for `strict-mix-gate`, kind `boolean`. Then
   `toggle-flag` to turn it **ON** so targeting applies. Leave it serving
   `false`. Do not start a guarded rollout.

## Then verify

Ask the user to run:

```bash
npm run seed -- --verify
```

That evaluates every config through the SDK and checks that
`strict-mix-gate` is serving `false`. If it fails, fix the missing
resource. Do not tell them to start the app until it exits 0.

## What you are not doing

- You are not editing application code. `strict-mix-gate` is already
  evaluated in `src/validate.js`.
- You are not starting a rollout. `/factory-release` does that, after the
  band is playing and burn-in is running.
- You are not cleaning up. `/factory-cleanup` is a later, separate step.
