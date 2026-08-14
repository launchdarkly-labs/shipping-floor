import { randomUUID } from 'node:crypto';
import { init } from '@launchdarkly/node-server-sdk';
import { initAi } from '@launchdarkly/server-sdk-ai';
import { ConfigProvider } from './provider.js';
import { parseSnippetDeclaration } from '../seed-material.js';

const NOOP_TRACKER = {
  async trackMetricsOf(_extract, call) { return call(); },
  trackFeedback() {},
  getTrackData() { return { variationKey: '', version: 0, modelName: null }; },
};

/**
 * The minimum plausible length of an assembled system prompt, and a string
 * that must appear in it.
 *
 * Both exist to catch ONE silent failure. LaunchDarkly resolves snippet
 * references server-side and the SDK renders the result through Mustache —
 * and Mustache renders an unresolved reference to the EMPTY STRING. A
 * mistyped snippet key therefore produces a musician with a persona, no
 * musical vocabulary, no gain ceiling, and no error anywhere in the system.
 * It would just quietly play worse. We would rather hold the pattern and say
 * so than call the model with a hollowed-out prompt.
 */
const MIN_SYSTEM_CHARS = 400;
const PERSONA_SENTINEL = 'Mix discipline';

/**
 * Resolves each musician's config from a LaunchDarkly AgentControl config via the AI
 * SDK. LaunchDarkly is the sole source of musical truth: the model, the
 * parameters, the persona, the gain ceiling, and every word of the musical
 * vocabulary live there, composed from versioned prompt snippets.
 *
 * There is deliberately NO local fallback. An outage means the band holds
 * and eventually falls silent, and that is the honest behaviour for a
 * tutorial whose entire claim is that the control plane owns this content —
 * a hidden default would make the demo lie about where the music comes from.
 * Mitigate it operationally (the preflight check in `npm start`), not in code.
 */
export class LaunchDarklyConfigProvider extends ConfigProvider {
  /**
   * @param {string} sdkKey - server-side SDK key for the target environment
   * @param {object} [opts]
   * @param {string} [opts.audience] - default listener audience for targeting
   * @param {string} [opts.projectKey] - project the configs live in (for deep links)
   * @param {string} [opts.appBaseUrl] - LaunchDarkly app base URL (for deep links)
   * @param {boolean} [opts.explain] - also call variationDetail() to recover WHICH
   *   rule matched. Costs a second evaluation event per generation, so it is
   *   opt-in via LD_EXPLAIN=1.
   */
  constructor(sdkKey, {
    audience = 'peak-hour',
    projectKey = 'shipping-floor',
    appBaseUrl = 'https://app.launchdarkly.com',
    explain = false,
  } = {}) {
    super();
    this.audience = audience;
    this.projectKey = projectKey;
    this.appBaseUrl = appBaseUrl;
    this.explain = explain;
    this.ldClient = init(sdkKey);
    this.aiClient = null;
    this.initError = null;
    this.ready = this.ldClient
      .waitForInitialization({ timeout: 10 })
      .then(() => {
        this.aiClient = initAi(this.ldClient);
      })
      .catch((error) => {
        this.initError = String(error?.message ?? error);
        console.warn('LaunchDarkly did not initialize; the band has no vocabulary and will hold.');
      });
  }

  /**
   * Build the multi-context for one generation.
   *
   * This replaced a single static `listener-${audience}` context built once
   * per process. That was the blocking defect on the whole release side: with
   * one context for the entire run, a guarded rollout has a sample size of 1
   * forever, and LaunchDarkly rolls it back for failing the minimum-context
   * requirement no matter what the guardrail metric says.
   *
   * `request` is the randomization unit — one generation, one coin flip. It
   * is why you hear a bad kick on SOME bars and not others during a
   * percentage rollout, which is the most useful thing a listener can be
   * shown about how rollouts actually work.
   */
  buildContext(musician, state = {}) {
    const {
      section = 'unknown',
      energy = 'unknown',
      isBoundary = false,
      cyclesLeftInSection = 0,
      audience = this.audience,
      take = randomUUID(),
    } = state;

    return {
      kind: 'multi',
      musician: { key: musician },
      performance: {
        key: `${section}-${energy}`,
        section,
        energy,
        isBoundary,
        cyclesLeftInSection,
      },
      listener: { key: `listener-${audience}`, audience },
      request: { key: `take-${take}`, take },
    };
  }

  async getMusicianConfig(musician, context) {
    await this.ready;
    const configKey = musician;
    const configUrl = `${this.appBaseUrl}/projects/${this.projectKey}/ai-configs/${configKey}`;
    const base = { source: 'launchdarkly', configKey, configUrl };

    if (!this.aiClient) {
      return {
        ...base,
        enabled: false,
        valid: false,
        invalidReason: `LaunchDarkly unreachable${this.initError ? `: ${this.initError}` : ''}`,
        source: 'launchdarkly (unreachable)',
        model: { name: null, parameters: {} },
        systemBase: '',
        snippets: [],
        variationKey: '',
        createTracker: () => NOOP_TRACKER,
      };
    }

    const ldContext = context ?? this.buildContext(musician);
    const cfg = await this.aiClient.completionConfig(configKey, ldContext, undefined, buildVariables(context));

    if (!cfg.enabled) {
      return {
        ...base,
        enabled: false,
        valid: false,
        invalidReason: 'config is toggled off in LaunchDarkly',
        source: 'launchdarkly (disabled)',
        model: { name: cfg.model?.name ?? null, parameters: cfg.model?.parameters ?? {} },
        systemBase: '',
        snippets: [],
        variationKey: '',
        createTracker: () => NOOP_TRACKER,
      };
    }

    // The AI SDK exposes the served variation for free on any tracker. An
    // EMPTY variationKey is the single most important signal in the whole
    // system: it means no flag evaluation happened and the SDK served its own
    // default, i.e. LaunchDarkly is not actually driving this musician.
    const probe = cfg.createTracker();
    const trackData = probe.getTrackData();

    // Snippet composition, recovered. LaunchDarkly strips the keys and
    // versions when it inlines snippet text, so the FIRST system message is
    // fully resolved prose with no provenance left in it. The second system
    // message carries a `snippets:` self-declaration that we parse here and
    // never send to the model.
    const systemMessages = (cfg.messages ?? []).filter((m) => m.role === 'system');
    const systemBase = systemMessages[0]?.content ?? '';
    const snippets = parseSnippetDeclaration(systemMessages[1]?.content) ?? [];

    // `gain_ceiling` and `strict_gain_ceiling` live in model.parameters so
    // that LaunchDarkly stays the source of truth for the invariant. They
    // MUST be pulled out here: src/llm.js spreads parameters straight into
    // the Anthropic request body, and an unknown body parameter is a 400.
    const { gain_ceiling: gainCeiling, strict_gain_ceiling: strictGainCeiling, ...parameters } =
      cfg.model?.parameters ?? {};

    const invalidReason = checkAssembledPrompt(systemBase);

    return {
      ...base,
      enabled: true,
      valid: !invalidReason,
      invalidReason,
      model: { name: cfg.model?.name, parameters },
      gainCeiling,
      strictGainCeiling,
      systemBase,
      snippets,
      variationKey: trackData.variationKey ?? '',
      variationVersion: trackData.version,
      reason: await this.#explain(configKey, ldContext),
      // A fresh tracker PER ATTEMPT, not per turn. Each carries its own runId,
      // and a retry genuinely is a separate execution of the model — tracking
      // only the first attempt is how "100% of spend is tracked" quietly
      // becomes false.
      createTracker: () => cfg.createTracker(),
    };
  }

  /**
   * Record a custom metric against the SAME multi-context that selected the
   * variation. The docs are explicit about this: "Use the same multi-context
   * in any custom event tracking calls to ensure consistency with how
   * variations are served." Pass a different context and the event lands on a
   * context that was never bucketed, and the rollout sees nothing.
   */
  async track(metricKey, context, value) {
    await this.ready;
    if (!this.ldClient) return;
    try {
      this.ldClient.track(metricKey, context, undefined, value);
    } catch (error) {
      console.warn(`track(${metricKey}) failed: ${error?.message ?? error}`);
    }
  }

  /**
   * Read a plain boolean flag against the same multi-context.
   *
   * This is the other unit of change in the tutorial: `strict-mix-gate` wraps
   * a CODE path in src/validate.js rather than a piece of prompt text. Same
   * rails — same context, same randomization unit, same guarded rollout — but
   * the thing being shipped is a diff instead of a snippet version.
   */
  async boolFlag(key, context, defaultValue = false) {
    await this.ready;
    if (!this.aiClient) return defaultValue;
    try {
      return await this.ldClient.variation(key, context, defaultValue);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Which targeting rule matched. The AI SDK calls plain variation(), so this
   * needs a parallel variationDetail() — a second evaluation event per
   * generation — and it returns {kind, ruleIndex, ruleId}, NOT human-readable
   * rule text. Turning that into "Rule 2 matched" is the UI's job.
   */
  async #explain(configKey, context) {
    if (!this.explain) return null;
    try {
      const detail = await this.ldClient.variationDetail(configKey, context, null);
      return detail?.reason ?? null;
    } catch {
      return null;
    }
  }

  async close() {
    try {
      await this.ldClient.flush();
    } catch {
      /* best effort */
    }
    await this.ldClient.close();
  }
}

/**
 * Variables offered to Mustache when LaunchDarkly renders the messages.
 *
 * The AI SDK renders every message through Mustache with `escape: item => item`,
 * so a variation's text can interpolate `{{section}}` or `{{energy}}` directly.
 * That means the prompt TEMPLATE itself can move into LaunchDarkly, not just
 * the prose — a variation author can write "the section is {{section}}"
 * without a deploy.
 */
function buildVariables(context) {
  const performance = context?.performance ?? {};
  const listener = context?.listener ?? {};
  return {
    section: performance.section ?? '',
    energy: performance.energy ?? '',
    isBoundary: performance.isBoundary ? 'yes' : 'no',
    cyclesLeftInSection: performance.cyclesLeftInSection ?? '',
    audience: listener.audience ?? '',
  };
}

/** @returns {string|null} a reason the assembled prompt is unusable, or null */
function checkAssembledPrompt(systemBase) {
  if (systemBase.includes('{{')) {
    return 'assembled prompt still contains an unresolved template reference';
  }
  if (systemBase.length < MIN_SYSTEM_CHARS) {
    return `assembled prompt is only ${systemBase.length} chars — a snippet reference probably resolved to nothing`;
  }
  if (!systemBase.includes(PERSONA_SENTINEL)) {
    return `assembled prompt has no "${PERSONA_SENTINEL}" section — the mix-discipline snippet did not resolve`;
  }
  return null;
}
