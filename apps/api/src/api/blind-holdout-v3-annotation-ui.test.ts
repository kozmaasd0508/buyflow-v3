import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerBlindHoldoutV3Annotation } from './blind-holdout-v3-annotation.js';

test('Blind v3 annotation page references a client script that parses successfully', async () => {
  const app = Fastify({ logger: false });
  await registerBlindHoldoutV3Annotation(app);
  await app.ready();

  const page = await app.inject({
    method: 'GET',
    url: '/audit-blind-v3-annotate',
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<script src="\/audit-blind-v3-annotate\.js" defer><\/script>/);
  assert.match(page.body, /UI indítása/);

  const scriptResponse = await app.inject({
    method: 'GET',
    url: '/audit-blind-v3-annotate.js',
  });
  assert.equal(scriptResponse.statusCode, 200);
  assert.match(scriptResponse.headers['content-type'] ?? '', /javascript/);
  assert.doesNotThrow(() => {
    new Function(scriptResponse.body);
  });
  assert.match(scriptResponse.body, /UI kész/);

  await app.close();
});
