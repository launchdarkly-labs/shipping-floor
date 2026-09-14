# AGENTS.md

Shipping Floor: three AI musicians (drummer, bassist, keys) generate Strudel patterns for a browser player. LaunchDarkly AgentControl delivers every word of their vocabulary and guards each change with a deterministic metric and automatic rollback. `README.md` is the design doc and the only documentation this repo ships; read it before changing `src/` or `seed/`.

## Setup and commands

- Node ≥ 22.9, ES modules, no build step. `npm install`, then `cp .env.example .env` (`ANTHROPIC_API_KEY`, `LAUNCHDARKLY_SDK_KEY`, `LAUNCHDARKLY_PROJECT_KEY`).
- `npm test` runs offline with no keys. Run it before every commit; done means all tests pass.
- `npm run seed` validates `seed/` offline and prints what LaunchDarkly must contain. `npm run seed -- --verify` evaluates every config through the SDK and reports what is actually served. Neither creates anything.
- `npm start` runs a preflight and refuses to start unless LaunchDarkly serves usable configs. That loud failure is intentional.
- `npm run burn-in` spends real money (about $1.50–3.50 per 1,000 generations). Run it only when asked, always with `--generations`.

## Invariants

These are the claim the repo makes. A change that violates one is wrong even if it works.

- **The application contains no music.** Groove rules, synth recipes, prompts, and gain ceilings live in LaunchDarkly snippets and variations. New musical vocabulary goes in `seed/snippets/` and a variation in `seed/configs.json`; `src/` stays vocabulary-free.
- **LaunchDarkly unreachable means the band holds, then falls silent.** A local fallback would make the claim above a lie.
- **The guardrail is deterministic and audio-free.** `maxGain()` in `src/validate.js` reads gain straight from the pattern string, strips mini-notation operators before reading numbers, takes the ceiling of `.range(a,b)`, and skips anything unrecognised. Browser and headless burn-in must produce the same metric.
- **Every variation's parameters include `gain_ceiling`.** A variation without one silently disables the guardrail for everyone it serves.
- **Snippet order in a variation is persona → mix discipline → vocabulary.** The mix discipline holds the ceiling and must sit above the vocabulary it constrains.
- **Every fact lives in the DOM; the canvas only dramatises.** No quality gate is audio-only.

## Editing `seed/`

`seed/` is never read at runtime; it exists so a prompt change is a reviewable diff. After editing it, both `npm run seed` and `npm test` must pass: every referenced snippet exists, targeting serves only declared variations, rollout weights total 100, and no vocabulary example asks for more gain than its musician's ceiling. A snippet edit changes nothing served until a variation pins the new version.

## LaunchDarkly resources

Create and change resources through the LaunchDarkly UI or the `.claude/commands/factory-*` slash commands over the LaunchDarkly MCP server (OAuth). Write-scoped API tokens stay out of this repo. After bootstrap, prompt and flag changes go through `/factory-classify` and a human.

## Gotchas

- `Unknown feature flag "drummer"` means the SDK key belongs to a different project, not that a config is off.
- A config with no targeting rules falls through to `disabled` and starts into nothing. Check the environment, not just the project.
- Strudel is AGPL and is loaded by the browser from a CDN. Node code only ever sends it pattern strings.
- `.env*` is gitignored except `.env.example`. `docs/` and `rehearsal-*.md` are ignored on purpose.
