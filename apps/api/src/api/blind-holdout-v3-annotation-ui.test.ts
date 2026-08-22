import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerBlindHoldoutV3Annotation } from './blind-holdout-v3-annotation.js';

test('Blind v3 annotation page serves JavaScript that parses successfully', async () => {
  const app = Fastify({ logger: false });
  await registerBlindHoldoutV3Annotation(app);
  await app.ready();

  const response = await app.inject({
    method: 'GET',
    url: '/audit-blind-v3-annotate',
  });

  assert.equal(response.statusCode, 200);
  const html = response.body;
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match?.[1], 'inline Blind v3 script should be present');
  assert.doesNotThrow(() => {
    // Parse the exact JavaScript emitted to the browser. Do not execute it.
    new Function(match[1]);
  });

  await app.close();
});
