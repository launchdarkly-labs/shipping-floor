import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Conductor } from '../src/conductor.js';
import { Musician } from '../src/musician.js';
import { createConfigProvider } from '../src/config/index.js';

/**
 * Rehearsal: run the band headless (no browser, no audio) for two minutes and
 * log every pattern each musician generates. This is the feedback loop for
 * listening to a change in the arrangement without opening a tab.
 *
 * It is NOT the burn-in. Rehearsal runs the real conductor at real tempo,
 * which means real time and a handful of generations — good for reading
 * output, useless for producing a statistically meaningful sample. When you
 * need volume, use `npm run burn-in`, which pins the conductor state and runs
 * concurrently.
 *
 * The log ends with a ready-to-paste stack() snapshot of the band's final
 * state, so you can audition the result at https://strudel.cc.
 *
 * Usage: npm run rehearsal            (2 minutes)
 *        REHEARSAL_SECONDS=30 npm run rehearsal
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DURATION_S = Number(process.env.REHEARSAL_SECONDS ?? 120);

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'band.config.json'), 'utf8'));
  const configProvider = createConfigProvider();
  const conductor = new Conductor(config);
  const audience = process.env.DEMO_AUDIENCE || 'peak-hour';

  const entries = [];
  const musicians = new Map();

  for (const name of Object.keys(config.musicians)) {
    musicians.set(name, new Musician({
      name,
      configProvider,
      audience,
      // No browser in rehearsal: lint-only, accept everything that survives it.
      publish: async () => ({ ok: true }),
      onEvent: (entry) => {
        entries.push({ at: elapsed(), ...entry });
        if (entry.event === 'pattern') {
          console.log(`\n[${elapsed()}s] ${entry.musician} (${entry.variationKey}, ${entry.section}, gain ${entry.gain}):\n  ${entry.pattern.replaceAll('\n', '\n  ')}`);
        } else if (entry.event === 'config') {
          console.log(`[${elapsed()}s] ${entry.musician} serving ${entry.variationKey || '(SDK DEFAULT — LaunchDarkly not driving this)'} v${entry.variationVersion ?? '?'}`);
        } else {
          console.log(`[${elapsed()}s] ${entry.musician} ${entry.event}: ${entry.reason ?? entry.error ?? ''}`);
        }
      },
    }));
  }

  conductor.on('regenerate', ({ musician, state }) => musicians.get(musician).regenerate(state));
  conductor.on('section', ({ section }) => console.log(`\n=== section: ${section.name} (energy: ${section.energy}) ===`));

  const startedAt = Date.now();
  function elapsed() {
    return Math.round((Date.now() - startedAt) / 1000);
  }

  console.log(`Rehearsing for ${DURATION_S}s at ${config.tempo.cps} cps (${config.key} ${config.scale}), listener: ${audience}...`);
  conductor.start();

  await new Promise((resolve) => setTimeout(resolve, DURATION_S * 1000));
  conductor.stop();
  // Flush before exit or the trailing metric events never reach LaunchDarkly.
  await configProvider.close();

  const logPath = join(ROOT, `rehearsal-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  await writeFile(logPath, renderLog(config, entries, musicians));
  console.log(`\nRehearsal over. Full log: ${logPath}`);
  process.exit(0);
}

function renderLog(config, entries, musicians) {
  const lines = [
    '# Rehearsal log',
    '',
    `- when: ${new Date().toISOString()}`,
    `- tempo: ${config.tempo.cps} cps, key: ${config.key} ${config.scale}`,
    '- model, parameters, and vocabulary: per the LaunchDarkly config variation served',
    '',
    '## Patterns',
    '',
  ];
  for (const entry of entries) {
    if (entry.event === 'pattern') {
      lines.push(`### ${entry.at}s — ${entry.musician} · ${entry.variationKey} · ${entry.section} · gain ${entry.gain}`, '', '```js', entry.pattern, '```', '');
    } else if (entry.event === 'config') {
      lines.push(`- ${entry.at}s — ${entry.musician} served **${entry.variationKey || 'SDK DEFAULT'}** v${entry.variationVersion ?? '?'}`);
    } else {
      lines.push(`- ${entry.at}s — ${entry.musician} ${entry.event}: ${entry.reason ?? entry.error ?? ''}`);
    }
  }

  lines.push(
    '',
    '## Ledger',
    '',
  );
  for (const musician of musicians.values()) {
    lines.push(`- **${musician.name}** — ${JSON.stringify(musician.ledger)}`);
  }

  lines.push(
    '',
    '## Final band state (paste into https://strudel.cc to audition)',
    '',
    '```js',
    `setcps(${config.tempo.cps})`,
    'stack(',
    [...musicians.values()]
      .map((m) => `  // ${m.name}\n  ${m.currentPattern.replaceAll('\n', '\n  ')}`)
      .join(',\n'),
    ')',
    '```',
    '',
  );
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
