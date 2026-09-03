/**
 * The two rollout guardrails, computed the way LaunchDarkly reads them.
 *
 * Both metrics are per-generation conversions: one flag evaluation per
 * regeneration cycle is the denominator, and the event fires at most once per
 * cycle. The ledger, though, counts `generations` per ATTEMPT, because a lint
 * retry is a second model call that costs real tokens and deserves its own
 * count. So the denominator here is `generations - retries`, which is exactly
 * the number of cycles. Dividing by `generations` instead would report a rate
 * that drifts below the metric whenever the band is retrying, which is
 * precisely when someone is staring at this panel.
 */
const cycles = (ledger) => Math.max(0, (ledger.generations ?? 0) - (ledger.retries ?? 0));

/** Did a generation reach the speakers at all. Higher is better. */
export function publishRate(ledger) {
  const total = cycles(ledger);
  return total === 0 ? null : (ledger.published ?? 0) / total;
}

/** Did a generation ask for more gain than its ceiling. Lower is better. */
export function breachRate(ledger) {
  const total = cycles(ledger);
  return total === 0 ? null : (ledger.ceilingBreaches ?? 0) / total;
}

/** Whole percents. A guardrail moving by tenths is noise at this sample size. */
export function formatRate(rate) {
  return rate == null ? null : `${Math.round(rate * 100)}%`;
}
