import { generatePattern } from './llm.js';
import { lintPattern, extractPattern } from './validate.js';

/** LaunchDarkly metric keys. Kept small on purpose; see seed/configs.json. */
const METRIC_PEAK_GAIN = 'peak-gain';
const METRIC_CEILING_BREACH = 'ceiling-breach-rate';
const METRIC_PUBLISH_SUCCESS = 'publish-success-rate';
const FLAG_STRICT_MIX_GATE = 'strict-mix-gate';

const MAX_ATTEMPTS = 2;

/**
 * One musician = one LLM loop that owns exactly one named layer.
 *
 * Everything this agent knows about music comes from LaunchDarkly. The
 * served config variation carries the model, the parameters, the gain
 * ceiling, the persona, and the one piece of musical vocabulary it is
 * playing right now — all composed server-side from versioned prompt
 * snippets. The application contains no music.
 *
 * Which vocabulary it gets is not a decision this code makes, and no longer
 * a decision the model makes either. It is a TARGETING decision: the
 * multi-context below carries who is listening and what the conductor is
 * doing, and LaunchDarkly's rules pick the variation. Changing the
 * arrangement means editing a targeting rule, which is auditable, revertible,
 * and does not require a deploy.
 *
 * Each regeneration is one pass of a small factory:
 *
 *   generate → gate → deploy → hold-last-known-good
 *
 * The agent produces an artifact (a Strudel pattern — that is code), a lint
 * gates it, the browser's real parser gates it again, it deploys at the next
 * cycle boundary, and on failure the previous pattern keeps looping. That
 * loop was always here. What it was missing was measurement.
 */
export class Musician {
  /**
   * @param {object} opts
   * @param {string} opts.name - musician id, e.g. "drummer" (also the layer name)
   * @param {import('./config/provider.js').ConfigProvider} opts.configProvider
   * @param {(musician: Musician, pattern: string) => Promise<{ok: boolean, error?: string}>} opts.publish
   * @param {(entry: object) => void} [opts.onEvent] - observability hook (logs/UI)
   * @param {string} [opts.audience] - listener audience carried in the context
   */
  constructor({ name, configProvider, publish, onEvent, audience = 'peak-hour' }) {
    this.name = name;
    this.configProvider = configProvider;
    this.publish = publish;
    this.onEvent = onEvent ?? (() => {});
    this.audience = audience;
    this.currentPattern = 'silence';
    this.busy = false;
    /** The most recent brief that arrived while busy. At most one. */
    this.pending = null;

    /**
     * The Factory Ledger. These are deliberately NOT LaunchDarkly metrics.
     * Only two things are worth guarding a release on; everything else is
     * operational detail that belongs on screen, not in a rollout decision.
     */
    this.ledger = {
      generations: 0,
      published: 0,
      lintRejected: 0,
      parseRejected: 0,
      ceilingBreaches: 0,
      retries: 0,
      keptPrevious: 0,
      configInvalid: 0,
    };
  }

  /**
   * Generate and publish a new pattern for the given conductor state.
   * Never throws — failures are logged and the previous pattern stands.
   *
   * A brief that arrives mid-generation is COALESCED, not dropped and not
   * queued. Dropping it was a real bug: the conductor fires the settle brief a
   * fixed two cycles after a boundary (4s at cps 0.5), but a boundary turn is a
   * model call plus a cycle-boundary wait, and doubles on a lint retry. Whenever
   * it ran long the settle was discarded, nothing re-armed it, and the musician
   * looped its one-cycle fill until its own stagger came due — up to 16 cycles.
   * That is exactly the failure settleAfterBoundaryCycles exists to prevent.
   *
   * Queueing would be just as wrong in the other direction: the conductor's
   * briefs are snapshots of a moving present, so a backlog would replay stale
   * musical state. Keeping only the newest gives the musician the world as it
   * is the moment it comes free.
   */
  async regenerate(state) {
    if (this.busy) {
      this.pending = state;
      return;
    }
    this.busy = true;
    try {
      let next = state;
      while (next) {
        this.pending = null;
        // The catch is INSIDE the loop on purpose. Outside it, a turn that
        // threw would exit the drain and take the queued brief with it — the
        // same dropped-brief bug this method exists to fix, reached through a
        // different door. A failed turn costs that turn only.
        try {
          await this.#regenerate(next);
        } catch (error) {
          this.onEvent({ musician: this.name, event: 'error', error: String(error.message ?? error) });
        }
        next = this.pending;
      }
    } finally {
      this.busy = false;
      this.pending = null;
    }
  }

  async #regenerate(state) {
    // Sitting out this section: rest instead of asking the model for silence.
    if (!state.playing) {
      if (this.currentPattern !== 'silence') {
        await this.#tryPublish('silence', state, null);
      }
      return;
    }

    // One context per generation. `request` is the randomization unit, so a
    // fresh key here is what gives a guarded rollout a real sample size.
    const context = this.configProvider.buildContext(this.name, {
      section: state.section,
      energy: state.energy,
      isBoundary: state.isBoundary,
      cyclesLeftInSection: state.cyclesLeftInSection,
      audience: this.audience,
    });

    const config = await this.configProvider.getMusicianConfig(this.name, context);

    this.onEvent({
      musician: this.name,
      event: 'config',
      source: config.source,
      configKey: config.configKey,
      configUrl: config.configUrl ?? null,
      model: config.model.name,
      variationKey: config.variationKey,
      variationVersion: config.variationVersion ?? null,
      snippets: config.snippets ?? [],
      gainCeiling: config.gainCeiling ?? null,
      reason: config.reason ?? null,
      context: describeContext(context),
    });

    if (!config.enabled) {
      // Toggled off, or LaunchDarkly is unreachable. Hold the current pattern
      // rather than go silent, so the band keeps playing while you fix it.
      this.onEvent({
        musician: this.name,
        event: 'config-disabled',
        configKey: config.configKey,
        reason: config.invalidReason,
      });
      return;
    }

    // The silent-failure guard. An unresolved snippet reference renders to
    // the empty string, so a mistyped key produces a musician with no musical
    // vocabulary and no error. Hold WITHOUT calling the model — paying for a
    // generation from a hollowed-out prompt helps nobody.
    if (!config.valid) {
      this.ledger.configInvalid += 1;
      this.onEvent({
        musician: this.name,
        event: 'config-invalid',
        reason: config.invalidReason,
        ledger: this.ledger,
      });
      return;
    }

    const strictMixGate = await this.configProvider.boolFlag(FLAG_STRICT_MIX_GATE, context, false);
    const lintOptions = {
      gainCeiling: config.gainCeiling,
      strictGainCeiling: config.strictGainCeiling,
      strictMixGate,
    };

    let feedback = null;
    let lastTracker = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // A fresh tracker per attempt: each gets its own runId, and a retry is
      // a separate execution that costs real tokens.
      const tracker = config.createTracker();
      lastTracker = tracker;
      if (attempt > 1) this.ledger.retries += 1;
      this.ledger.generations += 1;

      const raw = await generatePattern({
        model: config.model.name,
        parameters: config.model.parameters,
        system: this.#systemPrompt(config.systemBase),
        user: this.#userPrompt(state, feedback),
        tracker,
      });
      const pattern = extractPattern(raw);
      const lint = lintPattern(pattern, lintOptions);

      // peak-gain is a numeric VALUE metric: send it on every generation that
      // produced a readable gain, breach or not. The distribution is the
      // point — a rollout that shifts the whole curve up is interesting well
      // before anything crosses the line.
      if (lint.gain != null) {
        await this.configProvider.track(METRIC_PEAK_GAIN, context, lint.gain);
      }

      // ceiling-breach-rate is a binary CONVERSION metric, so the event is
      // sent only when it converts — i.e. only on a breach. Sending a 0 would
      // count as an occurrence and make the rate meaningless.
      if (lint.ceilingExceeded) {
        this.ledger.ceilingBreaches += 1;
        await this.configProvider.track(METRIC_CEILING_BREACH, context);
      }

      if (!lint.ok) {
        this.ledger.lintRejected += 1;
        feedback = `Your previous output was rejected before reaching the player: ${lint.reason}.`;
        this.onEvent({
          musician: this.name,
          event: 'lint-rejected',
          attempt,
          reason: lint.reason,
          gain: lint.gain,
          ceilingExceeded: Boolean(lint.ceilingExceeded),
          // Carried on every verdict, not just the successful ones. A
          // rejection is the most interesting signal a bad rollout produces,
          // and it is worthless if it cannot be attributed to an arm.
          variationKey: config.variationKey,
          pattern,
          ledger: this.ledger,
        });
        continue;
      }

      const result = await this.#tryPublish(pattern, state, { config, gain: lint.gain });
      if (result.ok) {
        this.ledger.published += 1;
        await this.configProvider.track(METRIC_PUBLISH_SUCCESS, context);
        tracker.trackFeedback({ kind: 'positive' });
        return;
      }

      this.ledger.parseRejected += 1;
      feedback = `Your previous output failed to parse in Strudel: ${result.error}.`;
      this.onEvent({
        musician: this.name,
        event: 'parse-rejected',
        attempt,
        reason: result.error,
        variationKey: config.variationKey,
        pattern,
        ledger: this.ledger,
      });
    }

    // Hold-last-known-good. The band never stops; it just stops changing.
    this.ledger.keptPrevious += 1;
    lastTracker?.trackFeedback({ kind: 'negative' });
    this.onEvent({
      musician: this.name,
      event: 'kept-previous',
      variationKey: config.variationKey,
      pattern: this.currentPattern,
      ledger: this.ledger,
    });
  }

  // ------------------------------------------------------------- prompts

  /**
   * The system prompt is almost entirely LaunchDarkly's. `systemBase` arrives
   * already assembled from three pinned snippets — persona, mix discipline,
   * and exactly one piece of vocabulary. What is added here is only the
   * output contract: the shape of the answer, not anything musical.
   */
  #systemPrompt(systemBase) {
    return [
      systemBase,
      '',
      'You are performing live. Each time you are briefed you output the next',
      'version of YOUR layer only, as a single Strudel pattern expression.',
      '',
      'Hard rules:',
      '- Output ONLY the Strudel expression. No markdown fences, no comments, no prose, no variable assignments, no semicolons.',
      '- One expression that evaluates to a single pattern (wrap simultaneous parts in stack(...)).',
      '- Use ONLY built-in synthesis sounds. Never load or reference sample packs.',
      '- Follow the conductor: stay in the given key and scale, and match the section energy.',
      '- Vary your part each regeneration — evolve, do not repeat yourself verbatim.',
    ].join('\n');
  }

  #userPrompt(state, feedback) {
    const lines = [
      'Conductor briefing:',
      `- key: ${state.key} ${state.scale}`,
      `- tempo: ${state.cps} cycles per second`,
      `- section: ${state.section} (energy: ${state.energy})`,
      `- next section: ${state.nextSection.name} (energy: ${state.nextSection.energy})`,
      `- cycle: ${state.cycle}`,
    ];
    if (state.isBoundary) {
      // The variation being served at a boundary IS the moment — targeting
      // already made that call. The model only needs to know it is playing a
      // one-cycle event, not decide whether to.
      lines.push(
        '',
        'A section boundary is landing on this cycle. Play the one-cycle event your',
        'vocabulary describes, built on your current part. You return to the plain',
        'groove a couple of cycles from now.',
      );
    }
    lines.push(
      '',
      'Your current pattern (replace it with a variation, do not repeat it exactly):',
      this.currentPattern,
    );
    if (feedback) {
      lines.push('', feedback, 'Fix the problem and output a corrected pattern.');
    }
    lines.push('', 'Output the new Strudel expression now.');
    return lines.join('\n');
  }

  async #tryPublish(pattern, state, meta) {
    const result = await this.publish(this, pattern);
    if (result.ok) {
      this.currentPattern = pattern;
      this.onEvent({
        musician: this.name,
        event: 'pattern',
        section: state.section,
        cycle: state.cycle,
        pattern,
        gain: meta?.gain ?? null,
        variationKey: meta?.config?.variationKey ?? null,
        ledger: this.ledger,
      });
    }
    return result;
  }
}

/** A compact, renderable summary of which contexts selected this variation. */
function describeContext(context) {
  return {
    musician: context.musician.key,
    performance: context.performance.key,
    listener: context.listener.key,
    request: context.request.key,
  };
}
