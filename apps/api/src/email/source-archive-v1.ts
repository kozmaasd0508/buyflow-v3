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

export interface ArchivedNormalizedObjectV1 {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: 'application/json';
}

export interface ArchivedEmailSourceV1 {
  traceId: string;
  document: NormalizedEmailDocumentV1;
  rawRef: RawEmailReference | null;
  normalizedRef: ArchivedNormalizedObjectV1;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function opaqueSegment(value: string): string {
  return sha256(value).slice(0, 32);
}

function deterministicTraceId(input: {
  userId: string;
  emailConnectionId: string;
  provider: string;
  providerMessageId: string;
}): string {
  const digest = createHash('sha256')
    .update(input.userId)
    .update('\0')
    .update(input.emailConnectionId)
    .update('\0')
    .update(input.provider)
    .update('\0')
    .update(input.providerMessageId)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateRetainedUntil(value: string | null | undefined): string | null {
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('Raw email retention boundary must be a valid timestamp');
  }
  return new Date(value).toISOString();
}

function sourceBaseKey(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
}): string {
  const messageHash = sha256(`${input.email.provider}\0${input.email.providerMessageId}`);
  return [
    'v1',
    `u_${opaqueSegment(input.userId)}`,
    `c_${opaqueSegment(input.emailConnectionId)}`,
    input.email.provider,
    messageHash,
  ].join('/');
}

/**
 * Archives immutable raw source bytes when available and always archives the
 * versioned normalized document. Keys are content-addressed/opaque so provider
 * message ids and user ids are not leaked in object paths.
 */
export async function archiveNormalizedEmailSourceV1(input: {
  userId: string;
  emailConnectionId: string;
  email: NormalizedEmail;
  store: EmailArchiveObjectStore;
  rawSource?: RawEmailSourceV1;
  traceId?: string;
}): Promise<ArchivedEmailSourceV1> {
  const baseKey = sourceBaseKey(input);
  const traceId = input.traceId ?? deterministicTraceId({
    userId: input.userId,
    emailConnectionId: input.emailConnectionId,
    provider: input.email.provider,
    providerMessageId: input.email.providerMessageId,
  });

  let rawRef: RawEmailReference | null = null;
  if (input.rawSource) {
    // Validate retention before writing any bytes so invalid metadata cannot
    // leave an orphaned raw object behind.
    const retainedUntil = validateRetainedUntil(input.rawSource.retainedUntil);
    const rawBytes = Buffer.from(input.rawSource.bytes);
    const rawSha256 = sha256(rawBytes);
    const contentType = input.rawSource.contentType?.trim() || 'message/rfc822';
    const objectKey = `${baseKey}/raw/${rawSha256}.eml`;
    await input.store.putImmutable({
      objectKey,
      bytes: rawBytes,
      contentType,
      sha256: rawSha256,
    });
    rawRef = {
      objectKey,
      sha256: rawSha256,
      sizeBytes: rawBytes.byteLength,
      contentType,
      retainedUntil,
    };
  }

  const document = normalizeEmailDocumentV1(input.email, {
    rawRef,
    traceId,
    normalizerVersion: NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER,
  });
  const normalizedBytes = Buffer.from(JSON.stringify(document), 'utf8');
  const normalizedSha256 = sha256(normalizedBytes);
  const normalizedRef: ArchivedNormalizedObjectV1 = {
    objectKey: `${baseKey}/normalized/${NORMALIZED_EMAIL_DOCUMENT_V1_NORMALIZER}/${normalizedSha256}.json`,
    sha256: normalizedSha256,
    sizeBytes: normalizedBytes.byteLength,
    contentType: 'application/json',
  };
  await input.store.putImmutable({
    objectKey: normalizedRef.objectKey,
    bytes: normalizedBytes,
    contentType: normalizedRef.contentType,
    sha256: normalizedRef.sha256,
  });

  return { traceId, document, rawRef, normalizedRef };
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
export class SupabaseEmailArchiveObjectStore implements EmailArchiveObjectStore {
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
    if (sha256(existingBytes) !== input.sha256) {
      throw new Error('Email source archive immutable-object conflict');
    }
  }
}
