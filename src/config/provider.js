/**
 * ConfigProvider — the seam between the band and LaunchDarkly.
 *
 * There is only one implementation, LaunchDarklyConfigProvider, and only one
 * source of musical truth. Everything a musician knows — model, parameters,
 * persona, gain ceiling, and the musical vocabulary itself — is delivered by
 * a LaunchDarkly AgentControl config variation assembled from versioned prompt
 * snippets. The application contains no music, and there is no local
 * fallback: if LaunchDarkly is unreachable the band holds and then falls
 * silent, which is the honest failure mode for that claim.
 *
 * getMusicianConfig returns:
 *
 *   {
 *     enabled: boolean,            // false ⇒ toggled off or unreachable; hold
 *     valid: boolean,              // false ⇒ prompt assembled wrong; hold WITHOUT calling the model
 *     invalidReason: string|null,
 *     source: string,              // e.g. 'launchdarkly' (shown in the UI)
 *     configKey: string,           // e.g. 'drummer'
 *     configUrl: string,           // deep link to edit the config
 *     model: { name, parameters }, // gain ceilings already destructured OUT
 *     gainCeiling: number,         // the mix-discipline invariant, as a number
 *     strictGainCeiling: number,   // the tighter ceiling behind strict-mix-gate
 *     systemBase: string,          // persona + mix discipline + one vocabulary
 *     snippets: [{key, version}],  // recovered from the second system message
 *     variationKey: string,        // '' ⇒ SDK DEFAULT SERVED, i.e. LD not driving this
 *     variationVersion: number,
 *     reason: object|null,         // {kind, ruleIndex, ruleId} when LD_EXPLAIN=1
 *     createTracker: () => Tracker // call once PER ATTEMPT, not per turn
 *   }
 */
export class ConfigProvider {
  /**
   * Build the evaluation context for one generation. This is where targeting
   * happens, so it is part of the seam rather than an implementation detail.
   * @param {string} musician
   * @param {object} state - section, energy, isBoundary, cyclesLeftInSection, audience
   * @returns {object} a LaunchDarkly multi-context
   */
  buildContext(musician, state) {
    throw new Error('ConfigProvider.buildContext not implemented');
  }

  /**
   * Resolve a musician's generation config for the given evaluation context.
   * @param {string} musician - e.g. "drummer"
   * @param {object} context - the multi-context from buildContext
   * @returns {Promise<object>} the resolved shape documented above
   */
  async getMusicianConfig(musician, context) {
    throw new Error('ConfigProvider.getMusicianConfig not implemented');
  }

  /**
   * Record a custom metric. MUST be called with the same context object that
   * selected the variation, or the event lands on a context that was never
   * bucketed and the rollout never sees it.
   */
  async track(metricKey, context, value) {}

  /** Read a plain boolean flag against the same context. */
  async boolFlag(key, context, defaultValue = false) {
    return defaultValue;
  }

  /** Release the underlying client/connection. */
  async close() {}
}
