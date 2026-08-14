import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Map an Anthropic Messages response to the LaunchDarkly AI SDK's metrics
 * shape. Passed to tracker.trackMetricsOf, which records duration and
 * success/error itself. (Node has no Anthropic provider package, so this is
 * the documented Tier-3 custom extractor.)
 */
export function anthropicMetrics(response) {
  const usage = response.usage ?? {};
  return {
    success: true,
    tokens: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    },
  };
}

/**
 * One generation call: a musician asking for its next pattern.
 *
 * There used to be a SELECT call in front of this one, in which the model
 * read a catalog of skill descriptions and chose which to load. That existed
 * only for progressive disclosure of skill bodies. With the vocabulary
 * delivered by LaunchDarkly — one variation carrying exactly one groove —
 * there is nothing left to disclose, and which vocabulary a musician gets is
 * a targeting decision rather than a judgment call the model re-makes eleven
 * times a minute.
 *
 * Deleting it also fixed a real defect: the selection call was completely
 * untracked and hard-coded max_tokens: 300, ignoring the configured
 * parameters entirely.
 *
 * The tracker is required, and there is one PER ATTEMPT. A retry is a
 * separate execution of the model that costs real tokens; passing null on
 * retries is how "100% of spend is tracked" stops being true.
 */
export async function generatePattern({ model, parameters, system, user, tracker }) {
  const call = () =>
    getClient().messages.create({
      model,
      ...parameters, // max_tokens, plus any temperature/top_p set in the config
      system,
      messages: [{ role: 'user', content: user }],
    });

  const response = await tracker.trackMetricsOf(anthropicMetrics, call);
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
