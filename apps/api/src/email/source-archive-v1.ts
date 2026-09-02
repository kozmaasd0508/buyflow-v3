import { createHash } from 'node:crypto';
import type { NormalizedEmailDocumentV1, RawEmailReference } from './document-v1.js';
import {
  NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER,
  normalizeEmailDocumentV1,
} from './normalize-document-v1.js';
import type { NormalizedEmail } from './types.js';

export interface RawEmailSourceV1 {
  bytes: Uint8Array;
  contentType?: string | null;
  retainedUntil?: string | null;
}

export interface EmailArchivePutInput {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
}

export interface EmailArchiveObjectStore {
  putImmutable(input: EmailArchivePutInput): Promise<void>;
}

export interface EmailArchiveDeletionStore {
  removeImmutable(objectKeys: string[]): Promise<void>;
}

export interface ArchivedNormalizedObjectV1 {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: 'application/json';
  retainedUntil: string;
}

export interface ArchivedEmailSourceV1 {
  traceId: string;
  sourceIdentitySha256: string;
  document: NormalizedEmailDocumentV1;
  rawRef: RawEmailReference | null;
  normalizedRef: ArchivedNormalizedObjectV1;
}

export interface PreparedEmailSourceArchiveV1 extends ArchivedEmailSourceV1 {
  rawObject: EmailArchivePutInput | null;
  normalizedObject: EmailArchivePutInput;
}

export function sha256EmailArchiveBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function opaqueSegment(value: string): string {
  return sha256EmailArchiveBytes(value).slice(0, 32);
}

function sourceIdentitySha256(input: {
  userId: string;
  emailConnectionId: string;
  provider: string;
  providerMessageId: string;
}): string {
  return createHash('sha256')
    .update(input.userId)
    .update('\0')
    .update(input.emailConnectionId)
    .update('\0')
    .update(input.provider)
    .update('\0')
    .update(input.providerMessageId)
    .digest('hex');
}

function deterministicTraceId(identitySha256: string): string {
  const digest = Buffer.from(identitySha256, 'hex');
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateFutureRetention(value: string | null | undefined, label: string, nowMs: number): string {
  if (!value) {
    throw new Error(`${label} retention boundary must be explicitly configured`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} retention boundary must be a valid timestamp`);
  }
  if (parsed <= nowMs) {
    throw new Error(`${label} retention boundary must be in the future`);
  }
  return new Date(parsed).toISOString();
}

function sourceBaseKey(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
}): string {
  const messageHash = sha256EmailArchiveBytes(`${input.email.provider}\0${input.email.providerMessageId}`);
  return [
    'v1',
    `u_${opaqueSegment(input.userId)}`,
    `c_${opaqueSegment(input.emailConnectionId)}`,
    input.email.provider,
    messageHash,
  ].join('/');
}

/**
 * Build every immutable artifact and integrity value before any object-store
 * write occurs. This lets the caller durably stage an archive manifest first.
 */
export function prepareNormalizedEmailSourceV1(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
  rawSource?: RawEmailSourceV1;
  normalizedRetainedUntil: string;
  traceId?: string;
  nowMs?: number;
}): PreparedEmailSourceArchiveV1 {
  const nowMs = input.nowMs ?? Date.now();
  const baseKey = sourceBaseKey(input);
  const identitySha256 = sourceIdentitySha256({
    userId: input.userId,
    emailConnectionId: input.emailConnectionId,
    provider: input.email.provider,
    providerMessageId: input.email.providerMessageId,
  });
  const traceId = input.traceId ?? deterministicTraceId(identitySha256);

  let rawRef: RawEmailReference | null = null;
  let rawObject: EmailArchivePutInput | null = null;
  if (input.rawSource) {
    const rawBytes = Buffer.from(input.rawSource.bytes);
    if (rawBytes.byteLength === 0) {
      throw new Error('Raw email source cannot be empty');
    }
    const retainedUntil = validateFutureRetention(
      input.rawSource.retainedUntil,
      'Raw email',
      nowMs,
    );
    const rawSha256 = sha256EmailArchiveBytes(rawBytes);
    const contentType = input.rawSource.contentType?.trim() || 'message/rfc822';
    const objectKey = `${baseKey}/raw/${rawSha256}.eml`;
    rawRef = {
      objectKey,
      sha256: rawSha256,
      sizeBytes: rawBytes.byteLength,
      contentType,
      retainedUntil,
    };
    rawObject = {
      objectKey,
      bytes: rawBytes,
      contentType,
      sha256: rawSha256,
    };
  }

  const normalizedRetainedUntil = validateFutureRetention(
    input.normalizedRetainedUntil,
    'Normalized email',
    nowMs,
  );
  const document = normalizeEmailDocumentV1(input.email, {
    rawRef,
    traceId,
    normalizerVersion: NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER,
  });
  const normalizedBytes = Buffer.from(JSON.stringify(document), 'utf8');
  const normalizedSha256 = sha256EmailArchiveBytes(normalizedBytes);
  const normalizedRef: ArchivedNormalizedObjectV1 = {
    objectKey: `${baseKey}/normalized/${NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER}/${normalizedSha256}.json`,
    sha256: normalizedSha256,
    sizeBytes: normalizedBytes.byteLength,
    contentType: 'application/json',
    retainedUntil: normalizedRetainedUntil,
  };

  return {
    traceId,
    sourceIdentitySha256: identitySha256,
    document,
    rawRef,
    normalizedRef,
    rawObject,
    normalizedObject: {
      objectKey: normalizedRef.objectKey,
      bytes: normalizedBytes,
      contentType: normalizedRef.contentType,
      sha256: normalizedRef.sha256,
    },
  };
}

export async function writePreparedEmailSourceArchiveV1(input: {
  prepared: PreparedEmailSourceArchiveV1;
  store: EmailArchiveObjectStore;
}): Promise<ArchivedEmailSourceV1> {
  if (input.prepared.rawObject) {
    await input.store.putImmutable(input.prepared.rawObject);
  }
  await input.store.putImmutable(input.prepared.normalizedObject);
  return {
    traceId: input.prepared.traceId,
    sourceIdentitySha256: input.prepared.sourceIdentitySha256,
    document: input.prepared.document,
    rawRef: input.prepared.rawRef,
    normalizedRef: input.prepared.normalizedRef,
  };
}

/**
 * Convenience wrapper for tests/non-durable callers. Production persistence
 * should stage a durable manifest before calling writePreparedEmailSourceArchiveV1.
 */
export async function archiveNormalizedEmailSourceV1(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
  store: EmailArchiveObjectStore;
  rawSource?: RawEmailSourceV1;
  normalizedRetainedUntil: string;
  traceId?: string;
  nowMs?: number;
}): Promise<ArchivedEmailSourceV1> {
  const prepared = prepareNormalizedEmailSourceV1(input);
  return writePreparedEmailSourceArchiveV1({ prepared, store: input.store });
}

interface SupabaseStorageBucketLike {
  upload(path: string, body: Uint8Array, options: {
    contentType: string;
    upsert: boolean;
    cacheControl: string;
  }): Promise<{ error: { message?: string; statusCode?: string | number; status?: string | number } | null }>;
  download(path: string): Promise<{
    data: Blob | null;
    error: { message?: string } | null;
  }>;
  remove(paths: string[]): Promise<{ error: { message?: string } | null }>;
}

interface SupabaseStorageClientLike {
  storage: {
    from(bucket: string): SupabaseStorageBucketLike;
  };
}

function isAlreadyExistsError(error: { message?: string; statusCode?: string | number; status?: string | number }): boolean {
  const status = Number(error.statusCode ?? error.status);
  return status === 409 || /already exists|duplicate|resource exists/i.test(error.message ?? '');
}

/** Service-role object-store implementation. The bucket must stay private. */
export class SupabaseEmailArchiveObjectStore implements EmailArchiveObjectStore, EmailArchiveDeletionStore {
  constructor(
    private readonly client: SupabaseStorageClientLike,
    private readonly bucket: string,
  ) {}

  async putImmutable(input: EmailArchivePutInput): Promise<void> {
    const storage = this.client.storage.from(this.bucket);
    const { error } = await storage.upload(input.objectKey, input.bytes, {
      contentType: input.contentType,
      upsert: false,
      cacheControl: '0',
    });
    if (!error) return;
    if (!isAlreadyExistsError(error)) {
      throw new Error(`Email source archive upload failed: ${error.message ?? 'unknown storage error'}`);
    }

    // A retry after object upload but before DB commit is expected. Verify the
    // existing bytes instead of silently accepting a conflicting object.
    const existing = await storage.download(input.objectKey);
    if (existing.error || !existing.data) {
      throw new Error(`Email source archive verification failed: ${existing.error?.message ?? 'missing object'}`);
    }
    const existingBytes = Buffer.from(await existing.data.arrayBuffer());
    if (sha256EmailArchiveBytes(existingBytes) !== input.sha256) {
      throw new Error('Email source archive immutable-object conflict');
    }
  }

  async removeImmutable(objectKeys: string[]): Promise<void> {
    const keys = [...new Set(objectKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(keys);
    if (error) {
      throw new Error(`Email source archive deletion failed: ${error.message ?? 'unknown storage error'}`);
    }
  }
}
