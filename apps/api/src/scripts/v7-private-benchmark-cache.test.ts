import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  benchmarkCacheKey,
  loadEncryptedBenchmarkJson,
  saveEncryptedBenchmarkJson,
} from './v7-private-benchmark-cache.js';

const SECRET = 'unit-test-secret-that-is-long-enough';

async function tempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'buyflow-v7-cache-'));
}

test('encrypted benchmark cache round-trips without plaintext at rest', async () => {
  const directory = await tempDirectory();
  try {
    const key = benchmarkCacheKey(['ai-v1', 'gpt-5.6-luna', 'private-order-body']);
    const value = {
      event_type: 'order_created',
      order_number: 'PRIVATE-ORDER-12345',
      total: 12990,
    };

    assert.equal(await saveEncryptedBenchmarkJson({ scope: 'ai', key, secret: SECRET, value, directory }), true);
    assert.deepEqual(await loadEncryptedBenchmarkJson<typeof value>({ scope: 'ai', key, secret: SECRET, directory }), value);

    const raw = await readFile(join(directory, 'ai', `${key}.enc.json`), 'utf8');
    assert.equal(raw.includes('PRIVATE-ORDER-12345'), false);
    assert.equal(raw.includes('order_created'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('wrong cache secret fails closed as a cache miss', async () => {
  const directory = await tempDirectory();
  try {
    const key = benchmarkCacheKey(['corpus-v1']);
    await saveEncryptedBenchmarkJson({ scope: 'corpus', key, secret: SECRET, value: { count: 300 }, directory });
    assert.equal(await loadEncryptedBenchmarkJson({
      scope: 'corpus',
      key,
      secret: 'another-long-secret-that-is-wrong',
      directory,
    }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('short secrets disable persistence instead of creating weak ciphertext', async () => {
  const directory = await tempDirectory();
  try {
    const key = benchmarkCacheKey(['disabled']);
    assert.equal(await saveEncryptedBenchmarkJson({ scope: 'ai', key, secret: 'short', value: { ok: true }, directory }), false);
    assert.equal(await loadEncryptedBenchmarkJson({ scope: 'ai', key, secret: 'short', directory }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cache keys are deterministic and content-sensitive', () => {
  const first = benchmarkCacheKey(['prompt-a', 'gpt-5.6-luna', 'body-a']);
  const same = benchmarkCacheKey(['prompt-a', 'gpt-5.6-luna', 'body-a']);
  const changed = benchmarkCacheKey(['prompt-a', 'gpt-5.6-luna', 'body-b']);
  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});
