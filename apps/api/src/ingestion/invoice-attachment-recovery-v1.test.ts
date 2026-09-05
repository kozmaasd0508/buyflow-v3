import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasInvoiceAttachmentContentConflict,
  invoiceAttachmentStoragePath,
} from './invoice-attachment-recovery-v1.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('DocVault attachment storage path is content-addressed and stable', () => {
  const path = invoiceAttachmentStoragePath('user-1', 'source-1', 'attachment-1', HASH_A);
  assert.match(path, /^user-1\/source-1\/[0-9a-f]{40}\/a{64}\.pdf$/);
  assert.equal(
    path,
    invoiceAttachmentStoragePath('user-1', 'source-1', 'attachment-1', HASH_A.toUpperCase()),
  );
  assert.notEqual(
    path,
    invoiceAttachmentStoragePath('user-1', 'source-1', 'attachment-1', HASH_B),
  );
});

test('DocVault rejects changed bytes for an already hashed attachment identity', () => {
  assert.equal(hasInvoiceAttachmentContentConflict(null, HASH_A), false);
  assert.equal(hasInvoiceAttachmentContentConflict(undefined, HASH_A), false);
  assert.equal(hasInvoiceAttachmentContentConflict(HASH_A, HASH_A), false);
  assert.equal(hasInvoiceAttachmentContentConflict(HASH_A.toUpperCase(), HASH_A), false);
  assert.equal(hasInvoiceAttachmentContentConflict(HASH_A, HASH_B), true);
});

test('DocVault rejects malformed content hashes before building a storage path', () => {
  assert.throws(
    () => invoiceAttachmentStoragePath('user-1', 'source-1', 'attachment-1', 'not-a-sha'),
    /invalid_attachment_content_sha256/,
  );
});
