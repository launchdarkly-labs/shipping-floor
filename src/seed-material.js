import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maxGain } from './validate.js';

/**
 * Reads seed/ — the local, reviewable source of truth for what must exist in
 * LaunchDarkly — and assembles it into the exact resources to create.
 *
 * seed/ is NOT read at runtime. The running band gets every word of its
 * musical vocabulary from LaunchDarkly and nowhere else. seed/ exists so the
 * setup is reviewable in a pull request, so `npm run seed` can validate it
 * before you spend clicks, and so a reader can diff what they have against
 * what the tutorial expects.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEED_DIR = join(ROOT, 'seed');

/**
 * Every snippet is pinned at a version in the variation that references it.
 * Seeding creates version 1 of each; a prompt CHANGE creates version 2 and a
 * NEW variation pinning it, never an in-place bump — snippet updates are
 * blocked during an active rollout, and bumping in place would destroy the
 * control arm of the rollout anyway.
 */
export const SEED_VERSION = 1;

export async function loadSeedMaterial() {
  const configs = JSON.parse(await readFile(join(SEED_DIR, 'configs.json'), 'utf8'));
  const snippets = new Map();

  for (const file of await readdir(join(SEED_DIR, 'snippets'))) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFile(join(SEED_DIR, 'snippets', file), 'utf8');
    const snippet = parseSnippet(raw, file);
    snippets.set(snippet.key, snippet);
  }

  return { configs, snippets, variations: buildVariations(configs, snippets) };
}

function parseSnippet(raw, file) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const [, frontmatter, body] = match;
  const meta = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.key) throw new Error(`${file}: frontmatter must include a key`);
  return {
    key: meta.key,
    musician: meta.musician,
    kind: meta.kind,
    description: meta.description ?? '',
    body: body.trim(),
    file,
  };
}

/**
 * Assemble every variation LaunchDarkly needs, including BOTH system messages.
 *
 * The second system message is not decoration. LaunchDarkly inlines snippet
 * text server-side, so the delivered messages[].content has the keys and
 * versions stripped out — there is no SDK path to "which snippets composed
 * this prompt". Declaring them in a second system message costs zero extra
 * calls, is self-documenting in the LaunchDarkly editor, and the config
 * provider parses it for the HUD and never forwards it to the model.
 */
function buildVariations(configs, snippets) {
  const out = [];
  for (const [musician, spec] of Object.entries(configs.musicians)) {
    for (const variation of spec.variations) {
      const refs = [spec.personaSnippet, spec.mixDisciplineSnippet, variation.vocabulary];
      for (const key of refs) {
        if (!snippets.has(key)) {
          throw new Error(`${musician}/${variation.key} references unknown snippet "${key}"`);
        }
      }
      out.push({
        musician,
        configKey: spec.configKey,
        key: variation.key,
        kind: variation.kind,
        snippetRefs: refs,
        messages: [
          { role: 'system', content: refs.map((key) => `{{snippet.${key}#${SEED_VERSION}}}`).join('\n\n') },
          { role: 'system', content: snippetDeclaration(refs) },
        ],
        parameters: {
          max_tokens: spec.maxTokens,
          gain_ceiling: spec.gainCeiling,
          strict_gain_ceiling: spec.strictGainCeiling,
        },
        // What the assembled prompt WILL be once LaunchDarkly resolves it.
        // Used to validate locally before anything is created.
        resolved: refs.map((key) => snippets.get(key).body).join('\n\n'),
      });
    }
  }
  return out;
}

/** `snippets: drummer-persona#1, drummer-mix-discipline#1, …` */
export function snippetDeclaration(refs) {
  return `snippets: ${refs.map((key) => `${key}#${SEED_VERSION}`).join(', ')}`;
}

/** Parse the declaration back out of a served config's second system message. */
export function parseSnippetDeclaration(content) {
  const match = /^\s*snippets:\s*(.+)$/im.exec(content ?? '');
  if (!match) return null;
  return match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, version] = entry.split('#');
      return { key: key.trim(), version: version ? Number(version) : null };
    });
}

/**
 * Validate the seed material against itself. The important check is the last
 * one: every gain in a musician's vocabulary must already sit under that
 * musician's ceiling, or the guardrail rejects legitimate patterns forever
 * and the musician holds. Run this BEFORE enabling the check, not after.
 */
export function validateSeedMaterial({ configs, snippets, variations }) {
  const problems = [];
  const used = new Set();

  for (const variation of variations) {
    for (const key of variation.snippetRefs) used.add(key);
  }
  for (const [key, snippet] of snippets) {
    if (!used.has(key)) problems.push({ level: 'warn', message: `snippet "${key}" (${snippet.file}) is not referenced by any variation` });
    // An unresolved snippet reference renders to the empty string under
    // Mustache, silently. A snippet body containing a brace could also break
    // templating of the variables we DO pass.
    if (snippet.body.includes('{')) {
      problems.push({ level: 'error', message: `snippet "${key}" contains "{" — Mustache will try to template it` });
    }
    if (snippet.body.length < 100) {
      problems.push({ level: 'error', message: `snippet "${key}" is suspiciously short (${snippet.body.length} chars)` });
    }
  }

  for (const [musician, spec] of Object.entries(configs.musicians)) {
    const served = new Set();
    for (const rule of spec.targeting.rules ?? []) served.add(rule.serve);
    if (spec.targeting.fallthrough?.serve) served.add(spec.targeting.fallthrough.serve);
    for (const entry of spec.targeting.fallthrough?.rollout ?? []) served.add(entry.variation);

    const declared = new Set(spec.variations.map((v) => v.key));
    for (const key of served) {
      if (!declared.has(key)) problems.push({ level: 'error', message: `${musician}: targeting serves undeclared variation "${key}"` });
    }
    for (const key of declared) {
      if (!served.has(key)) problems.push({ level: 'warn', message: `${musician}: variation "${key}" is never served by any rule` });
    }

    const weights = spec.targeting.fallthrough?.rollout;
    if (weights) {
      const total = weights.reduce((sum, w) => sum + w.weight, 0);
      if (total !== 100) problems.push({ level: 'error', message: `${musician}: fallthrough rollout weights total ${total}, not 100` });
    }
  }

  // The day-one blocker check. Every gain in the vocabulary vs the ceiling
  // that will be enforced against it.
  for (const variation of variations) {
    const spec = configs.musicians[variation.musician];
    for (const { code, line } of codeBlocks(snippets.get(variation.snippetRefs[2]))) {
      const gain = maxGain(code);
      if (gain != null && gain > spec.gainCeiling) {
        problems.push({
          level: 'error',
          message: `${variation.musician}/${variation.key}: vocabulary example at line ${line} asks for gain ${gain}, above the ${spec.gainCeiling} ceiling — this musician would reject its own vocabulary and hold`,
        });
      }
    }
  }

  return problems;
}

/** Fenced code blocks and inline-code spans that contain a gain call. */
export function* codeBlocks(snippet) {
  if (!snippet) return;
  const lines = snippet.body.split('\n');
  let fenced = false;
  let buffer = [];
  let start = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim().startsWith('```')) {
      if (fenced) {
        yield { code: buffer.join('\n'), line: start + 1 };
        buffer = [];
      } else {
        start = index + 1;
      }
      fenced = !fenced;
      continue;
    }
    if (fenced) buffer.push(line);
    else {
      for (const match of line.matchAll(/`([^`]*\.gain\([^`]*)`/g)) {
        yield { code: match[1], line: index + 1 };
      }
    }
  }
}
