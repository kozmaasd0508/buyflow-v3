import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const V7_PRIVATE_BENCHMARK_CACHE_VERSION = 'v7-private-benchmark-cache-v1';
export const V7_AI_INPUT_POLICY_VERSION = 'v7-structured-journey-input-v1';

const V7_BENCHMARK_ENCRYPTION_CONTEXT = 'buyflow:v7-private-benchmark-cache:aes-256-gcm:v1';

type CacheEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

let aiInputFingerprintPromise: Promise<string> | null = null;

function cacheDirectory(explicit?: string): string {
  const configured = explicit?.trim() || process.env.V7_BENCHMARK_CACHE_DIR?.trim();
  return resolve(configured || '.cache/v7-private-benchmark');
}

function encryptionKey(secret: string): Buffer | null {
  const normalized = secret.trim();
  if (normalized.length < 16) return null;
  return createHmac('sha256', normalized)
    .update(V7_BENCHMARK_ENCRYPTION_CONTEXT, 'utf8')
    .digest();
}

function safeScope(scope: string): string {
  const normalized = scope.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) throw new Error('invalid_benchmark_cache_scope');
  return normalized;
}

function safeKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('invalid_benchmark_cache_key');
  return normalized;
}

function cachePath(scope: string, key: string, explicitDirectory?: string): string {
  return join(cacheDirectory(explicitDirectory), safeScope(scope), `${safeKey(key)}.enc.json`);
}

export function benchmarkCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  const canonical = parts.map((part) => part === null || part === undefined ? '' : String(part)).join('\u0000');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function currentV7AiInputFingerprint(): Promise<string> {
  if (!aiInputFingerprintPromise) {
    aiInputFingerprintPromise = Promise.all([
      readFile(new URL('../ai/openai-email-extractor.ts', import.meta.url), 'utf8'),
      readFile(new URL('../ai/purchase-journey-context.ts', import.meta.url), 'utf8'),
    ]).then(([extractorSource, journeySource]) => createHash('sha256')
      .update(V7_AI_INPUT_POLICY_VERSION, 'utf8')
      .update('\u0000', 'utf8')
      .update(extractorSource, 'utf8')
      .update('\u0000', 'utf8')
      .update(journeySource, 'utf8')
      .digest('hex'));
  }
  return aiInputFingerprintPromise;
}

export async function loadEncryptedBenchmarkJson<T>(input: {
  scope: string;
  key: string;
  secret: string;
  directory?: string;
}): Promise<T | null> {
  const key = encryptionKey(input.secret);
  if (!key) return null;

  try {
    const raw = await readFile(cachePath(input.scope, input.key, input.directory), 'utf8');
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope>;
    if (
      envelope.version !== 1
      || envelope.algorithm !== 'aes-256-gcm'
      || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string'
      || typeof envelope.data !== 'string'
    ) return null;

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

export async function saveEncryptedBenchmarkJson<T>(input: {
  scope: string;
  key: string;
  secret: string;
  value: T;
  directory?: string;
}): Promise<boolean> {
  const key = encryptionKey(input.secret);
  if (!key) return false;

  const target = cachePath(input.scope, input.key, input.directory);
  await mkdir(dirname(target), { recursive: true });

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(input.value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: CacheEnvelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };

  const temporary = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return true;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
