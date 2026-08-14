import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Conductor } from './conductor.js';
import { Musician } from './musician.js';
import { Stage } from './stage.js';
import { createConfigProvider } from './config/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const CONFIG_PATH = join(ROOT, 'band.config.json');
const PORT = Number(process.env.PORT ?? 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const audience = process.env.DEMO_AUDIENCE || 'peak-hour';

  const httpServer = createServer(async (req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  const stage = new Stage(httpServer, { cps: config.tempo.cps });
  const configProvider = createConfigProvider();
  const conductor = new Conductor(config);

  await preflight(configProvider, Object.keys(config.musicians), audience);

  const musicians = new Map();
  for (const name of Object.keys(config.musicians)) {
    const musician = new Musician({
      name,
      configProvider,
      audience,
      publish: (m, pattern) => stage.applyLayer(m.name, pattern),
      onEvent: (entry) => {
        log(entry);
        if (entry.ledger) stage.updateMusicianMeta(entry.musician, { ledger: entry.ledger });

        if (entry.event === 'pattern') {
          const resting = entry.pattern === 'silence';
          stage.updateMusicianMeta(entry.musician, {
            pattern: entry.pattern,
            gain: entry.gain,
            status: resting ? 'resting' : 'playing',
          });
          stage.pushEvent({
            type: 'shipped',
            musician: entry.musician,
            gain: entry.gain,
            // Carried so the UI can tally the OBSERVED variation split across
            // real traffic. That split is the only rollout signal this app can
            // honestly produce: the SDK evaluates flags, it does not expose
            // guarded-rollout progress.
            variationKey: entry.variationKey,
          });
        } else if (entry.event === 'config') {
          // Config provenance — this is where LaunchDarkly's control becomes
          // visible. An EMPTY variationKey is the alarm state: it means the
          // SDK served its own default and LaunchDarkly is not driving this
          // musician at all.
          stage.updateMusicianMeta(entry.musician, {
            configSource: entry.source,
            configKey: entry.configKey,
            configUrl: entry.configUrl,
            model: entry.model,
            variation: entry.variationKey
              ? { key: entry.variationKey, version: entry.variationVersion }
              : null,
            snippets: entry.snippets,
            gainCeiling: entry.gainCeiling,
            reason: entry.reason,
            context: entry.context,
          });
        } else if (entry.event === 'config-disabled' || entry.event === 'config-invalid') {
          stage.updateMusicianMeta(entry.musician, { status: entry.reason ?? 'config unavailable' });
          stage.pushEvent({ type: 'alarm', musician: entry.musician, reason: entry.reason });
        } else if (entry.event === 'lint-rejected' || entry.event === 'parse-rejected') {
          stage.updateMusicianMeta(entry.musician, { status: `retrying (${entry.reason})` });
          stage.pushEvent({
            type: 'rejected',
            musician: entry.musician,
            reason: entry.reason,
            ceilingExceeded: Boolean(entry.ceilingExceeded),
          });
        } else if (entry.event === 'kept-previous') {
          stage.pushEvent({ type: 'held', musician: entry.musician });
        }
      },
    });
    musicians.set(name, musician);
  }

  conductor.on('regenerate', ({ musician, state }) => {
    stage.updateMusicianMeta(musician, { status: 'thinking' });
    musicians.get(musician).regenerate(state).then(() => {
      const m = musicians.get(musician);
      stage.updateMusicianMeta(musician, {
        status: m.currentPattern === 'silence' ? 'resting' : 'playing',
      });
    });
  });

  conductor.on('section', ({ section }) => {
    log({ event: 'section', section: section.name, energy: section.energy });
    stage.updateMeta({ section: section.name, energy: section.energy });
    stage.pushEvent({ type: 'section', section: section.name, energy: section.energy });
  });

  conductor.on('cycle', ({ cycle }) => {
    stage.updateMeta({ cycle });
  });

  stage.updateMeta({
    section: conductor.section.name,
    energy: conductor.section.energy,
    key: `${config.key} ${config.scale}`,
    listener: { audience },
    band: Object.keys(config.musicians),
  });

  httpServer.listen(PORT, () => {
    console.log(`\n  Shipping Floor`);
    console.log(`  ──────────────`);
    console.log(`  Player:   http://localhost:${PORT}  (open this and press Play)`);
    console.log(`  Configs:  LaunchDarkly — every note of the vocabulary lives there`);
    console.log(`  Listener: ${audience}`);
    console.log(`\n  Change a targeting rule or a variation in LaunchDarkly and you will`);
    console.log(`  hear it at the next regeneration. No restart, no redeploy.\n`);
    conductor.start();
  });

  // Flush LaunchDarkly events on shutdown so trailing metrics aren't lost.
  const shutdown = async () => {
    conductor.stop();
    await configProvider.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Fail loudly, before the first note, rather than quietly playing nothing.
 *
 * The "keep it pure" call — no local defaults — means a bad SDK key or a
 * missing config leaves the band with no vocabulary at all and no way to
 * cold-start. That is an accepted regression, but only if it is legible: an
 * unexplained silent band is the worst possible demo failure.
 */
async function preflight(configProvider, names, audience) {
  const problems = [];
  for (const name of names) {
    const context = configProvider.buildContext(name, {
      section: 'preflight',
      energy: 'medium',
      isBoundary: false,
      audience,
    });
    const config = await configProvider.getMusicianConfig(name, context);
    if (!config.enabled) problems.push(`${name}: ${config.invalidReason ?? 'config unavailable'}`);
    else if (!config.variationKey) problems.push(`${name}: LaunchDarkly served the SDK default — no variation was evaluated`);
    else if (!config.valid) problems.push(`${name}: ${config.invalidReason}`);
  }

  if (problems.length) {
    console.error('\n  Preflight failed — LaunchDarkly is not delivering usable configs:\n');
    for (const problem of problems) console.error(`    ✗ ${problem}`);
    console.error('\n  This app has no local musical content by design, so it cannot start');
    console.error('  without them. Run `npm run seed` to see exactly what must exist.\n');
    process.exit(1);
  }
}

function log(entry) {
  const time = new Date().toISOString().slice(11, 19);
  const { event, musician, ledger: _ledger, snippets: _snippets, context: _context, ...rest } = entry;
  const detail = Object.entries(rest)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.replaceAll('\n', ' ') : JSON.stringify(v)}`)
    .join(' ');
  console.log(`[${time}] ${musician ?? 'band'} ${event} ${detail}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
