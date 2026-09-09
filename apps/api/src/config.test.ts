import assert from 'node:assert/strict';
import test from 'node:test';
import { BUYFLOW_RUNTIME_OPENAI_MODEL, env } from './config.js';

test('BuyFlow server OpenAI runtime is pinned to GPT-5.6 Luna', () => {
  assert.equal(BUYFLOW_RUNTIME_OPENAI_MODEL, 'gpt-5.6-luna');
  assert.equal(env.OPENAI_MODEL, 'gpt-5.6-luna');
});
