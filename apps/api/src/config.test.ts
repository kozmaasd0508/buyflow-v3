import assert from 'node:assert/strict';
import test from 'node:test';
import { BUYFLOW_RUNTIME_OPENAI_MODEL, env, isSolVerifierConfigured, requireOpenAIConfig } from './config.js';
import { BUYFLOW_SOL_VERIFIER_MODEL } from './ai/sol-verification-policy.js';

test('BuyFlow server OpenAI runtime is pinned to GPT-5.6 Luna', () => {
  assert.equal(BUYFLOW_RUNTIME_OPENAI_MODEL, 'gpt-5.6-luna');
  assert.equal(env.OPENAI_MODEL, 'gpt-5.6-luna');
});


test('BuyFlow selective verifier is pinned to GPT-5.6 Sol and enabled by default', () => {
  assert.equal(BUYFLOW_SOL_VERIFIER_MODEL, 'gpt-5.6-sol');
  assert.equal(env.BUYFLOW_SOL_VERIFIER_ENABLED, true);
  assert.equal(isSolVerifierConfigured(), Boolean(env.OPENAI_API_KEY));
  if (env.OPENAI_API_KEY) {
    const config = requireOpenAIConfig();
    assert.equal(config.model, 'gpt-5.6-luna');
    assert.equal(config.verifierModel, 'gpt-5.6-sol');
    assert.equal(config.verifierEnabled, true);
  }
});
