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
 * Map an Anthropic Messages response to the usage shape the AI SDK reads.
 *
 * Anthropic already names these input_tokens/output_tokens, which is one of
 * the spellings the SDK recognises. It derives the total itself, so none is
 * reported here. (Node has no Anthropic provider package, so the call is
 * wrapped in a custom handler.)
 */
export function anthropicUsage(response) {
  const usage = response.usage ?? {};
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
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
 * This no longer takes a tracker. It is called from inside the handler that
 * the AI SDK invokes, so duration and success/error are recorded around it
 * automatically, and it just reports the tokens it used. There is still one
 * execution PER ATTEMPT: a retry is a separate invoke() with its own runId,
 * which is what keeps "100% of spend is tracked" true.
 *
 * @returns {Promise<{text: string, usage: object}>}
 */
export async function generatePattern({ model, parameters, system, user }) {
  const response = await getClient().messages.create({
    model,
    ...parameters, // max_tokens, plus any temperature/top_p set in the config
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return { text, usage: anthropicUsage(response) };
}
