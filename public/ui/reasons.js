/**
 * Turning LaunchDarkly's evaluation reason into a sentence a human reads.
 *
 * This file exists because of a real gap. The AI SDK calls plain
 * `variation()`, not `variationDetail()`, so the served config carries no
 * reason at all — recovering one needs a parallel `variationDetail()` call
 * (a second evaluation event per generation, which is why it sits behind
 * LD_EXPLAIN=1). And even then the SDK returns `{kind, ruleIndex, ruleId}`,
 * NOT the rule's text. There is no API that hands you "isBoundary AND
 * energy = high".
 *
 * So the mapping from rule index to English is hand-maintained, right here,
 * and it has to be kept in step with seed/configs.json. That is a real cost
 * and it is worth stating plainly rather than hiding: the honest version of
 * "the dashboard explains itself" is that someone wrote these strings.
 */

/** Keep in step with the `targeting.rules` arrays in seed/configs.json. */
const RULE_LABELS = {
  drummer: [
    'listener is in the lounge, and a section just changed',
    'listener is in the lounge',
    'a section just changed into a high-energy one',
    'a section just changed into a medium-energy one',
    'the section is the lift',
  ],
  bassist: [
    'listener is in the lounge',
    'a section just changed into a high-energy one',
  ],
  keys: [
    'listener is in the lounge',
    'a section just changed into a high-energy one',
    'the section is low-energy',
  ],
};

/**
 * @param {string} musician
 * @param {object|null} reason - LaunchDarkly's {kind, ruleIndex, ruleId, inExperiment}
 * @returns {string} a sentence, never a code
 */
export function describeReason(musician, reason) {
  if (!reason) return 'reason not requested — set LD_EXPLAIN=1 to ask LaunchDarkly which rule matched';

  switch (reason.kind) {
    case 'RULE_MATCH': {
      const label = RULE_LABELS[musician]?.[reason.ruleIndex];
      return label
        ? `Rule ${reason.ruleIndex + 1} matched: ${label}`
        : `Rule ${reason.ruleIndex + 1} matched`;
    }
    case 'FALLTHROUGH':
      // The percentage rollout across groove variations lives on the
      // fallthrough, so this is the common case, not an edge case.
      return reason.inExperiment
        ? 'No rule matched — this take was bucketed by its own request key'
        : 'No rule matched — serving the default';
    case 'TARGET_MATCH':
      return 'This context is individually targeted';
    case 'PREREQUISITE_FAILED':
      return `A prerequisite flag (${reason.prerequisiteKey ?? 'unknown'}) is not satisfied`;
    case 'OFF':
      return 'Targeting is off — serving the off variation';
    case 'ERROR':
      return `Evaluation error: ${reason.errorKind ?? 'unknown'}`;
    default:
      return reason.kind ?? 'unknown';
  }
}

/**
 * The single most important pixel in the HUD.
 *
 * An empty variation key means no flag evaluation happened — the SDK returned
 * its own default because LaunchDarkly was unreachable or the config does not
 * exist. The band would still be playing, which is exactly what makes it
 * dangerous: everything looks fine and LaunchDarkly is driving none of it.
 */
export function describeServing(variation) {
  if (!variation || !variation.key) {
    return { text: 'SDK DEFAULT — LaunchDarkly is not driving this musician', alarm: true };
  }
  return { text: `${variation.key} · v${variation.version}`, alarm: false };
}
