import { loadSeedMaterial, validateSeedMaterial, SEED_VERSION } from '../src/seed-material.js';

/**
 * npm run seed            validate seed/ and print the LaunchDarkly resources to create
 * npm run seed -- --verify   additionally evaluate every config through the SDK and
 *                            check what LaunchDarkly actually serves back
 *
 * This script deliberately does NOT write to LaunchDarkly.
 *
 * Creating these resources is driven from the LaunchDarkly UI or the
 * `.claude/commands/factory-*` slash commands over the LaunchDarkly MCP
 * server, which authenticates with OAuth. There is no write-scoped
 * LAUNCHDARKLY_API_TOKEN in this repo. `/factory-bootstrap` creates the
 * seed list once so a first run can start at Play. Later prompt changes
 * still go through `/factory-classify` and a human.
 *
 * What this script IS good for: catching the mistakes that are expensive to
 * discover later — a snippet the targeting never serves, rollout weights that
 * do not total 100, and above all a piece of vocabulary that asks for more
 * gain than the ceiling about to be enforced against it.
 */

/**
 * Three scenarios that between them exercise every targeting rule shape:
 * a plain groove, a high-energy boundary (which should serve a moment), and
 * a lounge listener (whose shelf is much thinner).
 *
 * Declared before use: `verify()` is called from top-level await further down,
 * and a `const` is not hoisted the way a function declaration is.
 */
const SCENARIOS = [
  { name: 'groove / medium', state: { section: 'groove', energy: 'medium', isBoundary: false, audience: 'peak-hour' } },
  { name: 'boundary / high', state: { section: 'lift', energy: 'high', isBoundary: true, audience: 'peak-hour' } },
  { name: 'lounge', state: { section: 'groove', energy: 'medium', isBoundary: false, audience: 'lounge' } },
];

const args = new Set(process.argv.slice(2));
const material = await loadSeedMaterial();
const problems = validateSeedMaterial(material);

const errors = problems.filter((p) => p.level === 'error');
const warnings = problems.filter((p) => p.level === 'warn');

heading('Seed material');
console.log(`  ${material.snippets.size} snippets, ${material.variations.length} variations across ${Object.keys(material.configs.musicians).length} configs`);
const targetProject =
  process.env.LAUNCHDARKLY_PROJECT_KEY || material.configs.projectKey;
console.log(`  seed default project: ${material.configs.projectKey}`);
console.log(`  this run targets:     ${targetProject}${
  process.env.LAUNCHDARKLY_PROJECT_KEY ? '' : '  (set LAUNCHDARKLY_PROJECT_KEY for a new project)'
}`);

if (warnings.length) {
  heading('Warnings');
  for (const p of warnings) console.log(`  ! ${p.message}`);
}
if (errors.length) {
  heading('Errors');
  for (const p of errors) console.log(`  ✗ ${p.message}`);
} else {
  console.log('\n  ✓ seed material is self-consistent');
  console.log('  ✓ every vocabulary example sits under its musician\'s gain ceiling');
}

heading('1 · Context kinds');
console.log('  Features → Contexts is the instance list. Kinds are gear → Add kind');
console.log('  (often admin-only) or they appear after an SDK evaluation.');
console.log('  Tick "Available for experiments and guarded rollouts" on request');
console.log('  BEFORE creating metrics. create-metric with randomizationUnits');
console.log('  ["request"] fails until that unit exists. Omitting the field');
console.log('  defaults the metric to user, and there is no update-metric tool.\n');
for (const kind of material.configs.contextKinds) {
  console.log(`  ${kind.key.padEnd(12)} ${kind.name}`);
}

heading('2 · Prompt snippets');
console.log(`  All created at version ${SEED_VERSION}. Editing a snippet creates a NEW version;`);
console.log('  it changes nothing in production until a variation pins the new version.\n');
for (const [key, snippet] of [...material.snippets].sort()) {
  console.log(`  ${key.padEnd(30)} ${String(snippet.body.length).padStart(5)} chars  ${snippet.kind}`);
}

heading('3 · Config variations');
for (const variation of material.variations) {
  console.log(`\n  ── ${variation.configKey} / ${variation.key}  (${variation.kind})`);
  console.log(`     parameters: ${JSON.stringify(variation.parameters)}`);
  console.log('     system message 1:');
  for (const line of variation.messages[0].content.split('\n')) console.log(`       ${line}`);
  console.log('     system message 2:');
  console.log(`       ${variation.messages[1].content}`);
}

heading('4 · Targeting');
for (const [musician, spec] of Object.entries(material.configs.musicians)) {
  console.log(`\n  ── ${spec.configKey}`);
  for (const rule of spec.targeting.rules ?? []) {
    const conditions = Object.entries(rule.if).map(([k, v]) => `${k} = ${v}`).join(' AND ');
    console.log(`     if ${conditions.padEnd(58)} → ${rule.serve}`);
  }
  if (spec.targeting.fallthrough.rollout) {
    const parts = spec.targeting.fallthrough.rollout.map((r) => `${r.weight}% ${r.variation}`).join(', ');
    console.log(`     fallthrough${''.padEnd(52)} → ${parts}`);
  } else {
    console.log(`     fallthrough${''.padEnd(52)} → ${spec.targeting.fallthrough.serve}`);
  }
}

heading('5 · Metrics');
console.log('  Create these AFTER request is an experiment unit. Analysis unit');
console.log('  must be "request" on all three, matching the rollout.\n');
for (const metric of material.configs.metrics) {
  console.log(`  ${metric.key.padEnd(22)} ${metric.kind.padEnd(11)} ${metric.successCriteria}`);
}

heading('6 · Flags');
console.log('  Boolean flags the application already evaluates. Create each one');
console.log('  serving its default, then turn it ON so targeting applies.\n');
for (const flag of material.configs.flags ?? []) {
  console.log(`  ${flag.key.padEnd(22)} default ${flag.default}  ${flag.description}`);
}

if (args.has('--verify')) {
  await verify(material);
} else {
  heading('Next');
  console.log('  Fast path: set LAUNCHDARKLY_PROJECT_KEY to a new project, then');
  console.log('  /factory-bootstrap. If Add kind is disabled, let bootstrap create');
  console.log('  configs first, run --verify so the kinds appear, tick Available');
  console.log('  for experiments on request, then create the metrics.\n');
  console.log('  Then check what LaunchDarkly actually serves back:\n');
  console.log('      npm run seed -- --verify\n');
}

// `verify()` reports LaunchDarkly failures by setting process.exitCode, and an
// explicit process.exit() argument would override it — so a --verify run that
// printed "9 check(s) failed" would still exit 0, and every CI gate and `&&`
// chain built on this command would pass while LaunchDarkly drove nothing.
process.exit(errors.length || process.exitCode ? 1 : 0);

/**
 * The Phase 0 gate, run for real: evaluate every config through the SDK and
 * assert that LaunchDarkly serves a real variation with fully resolved
 * snippet content.
 *
 * Two failures matter and they look nothing alike:
 *   - variationKey === ''  means NO flag evaluation happened — the SDK served
 *     its own default because LaunchDarkly was unreachable or the config does
 *     not exist. The band would be playing with no vocabulary at all.
 *   - a residual '{{' means a snippet reference did not resolve. Mustache
 *     renders an unresolved reference to the EMPTY STRING, so this is the one
 *     failure that is otherwise completely silent.
 */
async function verify(material) {
  heading('Verifying against LaunchDarkly');

  const { createConfigProvider } = await import('../src/config/index.js');
  const provider = createConfigProvider();
  let failures = 0;

  for (const musician of Object.keys(material.configs.musicians)) {
    for (const scenario of SCENARIOS) {
      const context = provider.buildContext(musician, scenario.state);
      const config = await provider.getMusicianConfig(musician, context);
      const label = `${musician} · ${scenario.name}`;

      if (!config.enabled) {
        console.log(`  ✗ ${label.padEnd(34)} config disabled or unreachable (${config.source})`);
        failures += 1;
        continue;
      }
      if (!config.variationKey) {
        console.log(`  ✗ ${label.padEnd(34)} SDK DEFAULT served — LaunchDarkly did not evaluate a variation`);
        failures += 1;
        continue;
      }
      if (config.systemBase.includes('{{')) {
        console.log(`  ✗ ${label.padEnd(34)} unresolved snippet reference in the assembled prompt`);
        failures += 1;
        continue;
      }
      if (!config.valid) {
        console.log(`  ✗ ${label.padEnd(34)} ${config.invalidReason}`);
        failures += 1;
        continue;
      }
      const snippets = (config.snippets ?? []).map((s) => `${s.key}#${s.version}`).join(', ');
      console.log(`  ✓ ${label.padEnd(34)} ${config.variationKey} v${config.variationVersion} · ceiling ${config.gainCeiling} · ${snippets || 'no snippet declaration'}`);
    }
  }

  const flagContext = provider.buildContext('drummer', SCENARIOS[0].state);
  for (const flag of material.configs.flags ?? []) {
    // Default true on purpose: a missing flag returns the default, so false
    // here means LaunchDarkly actually served the off variation.
    const served = await provider.boolFlag(flag.key, flagContext, true);
    if (served !== flag.default) {
      console.log(`  ✗ ${flag.key.padEnd(34)} served ${served}; expected ${flag.default} (missing or already rolling out)`);
      failures += 1;
    } else {
      console.log(`  ✓ ${flag.key.padEnd(34)} serving ${served}`);
    }
  }

  await provider.close();
  console.log(failures ? `\n  ${failures} check(s) failed.` : '\n  All checks passed.');
  if (failures) process.exitCode = 1;
}

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}
