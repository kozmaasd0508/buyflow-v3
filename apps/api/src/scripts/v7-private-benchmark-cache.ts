import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const V7_PRIVATE_BENCHMARK_CACHE_VERSION = 'v7-private-benchmark-cache-v1';

type CacheEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

let extractorFingerprintPromise: Promise<string> | null = null;

function cacheDirectory(explicit?: string): string {
  const configured = explicit?.trim() || process.env.V7_BENCHMARK_CACHE_DIR?.trim();
  return resolve(configured || '.cache/v7-private-benchmark');
}

function encryptionKey(secret: string): Buffer | null {
  const normalized = secret.trim();
  if (normalized.length < 16) return null;
  return createHash('sha256').update(normalized, 'utf8').digest();
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

export async function currentOpenAIExtractorFingerprint(): Promise<string> {
  if (!extractorFingerprintPromise) {
    extractorFingerprintPromise = readFile(new URL('../ai/openai-email-extractor.ts', import.meta.url), 'utf8')
      .then((source) => createHash('sha256').update(source, 'utf8').digest('hex'));
  }
  return extractorFingerprintPromise;
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
  const dir = target.slice(0, target.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });

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
