import { LaunchDarklyConfigProvider } from './launchdarkly.js';

/**
 * The config layer is delivered by LaunchDarkly. A server-side SDK key is
 * required; there is no local config source and no baked-in musical content.
 */
export function createConfigProvider() {
  const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;
  if (!sdkKey) {
    throw new Error(
      'LAUNCHDARKLY_SDK_KEY is not set. Copy .env.example to .env and add your ' +
        'LaunchDarkly server-side SDK key — the musicians’ model, prompt, and every ' +
        'note of their musical vocabulary come from LaunchDarkly AgentControl configs.',
    );
  }
  return new LaunchDarklyConfigProvider(sdkKey, {
    audience: process.env.DEMO_AUDIENCE || 'peak-hour',
    projectKey: process.env.LAUNCHDARKLY_PROJECT_KEY || 'shipping-floor',
    explain: process.env.LD_EXPLAIN === '1',
  });
}
