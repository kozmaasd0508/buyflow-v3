import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../../supabase/migrations/20260902162000_harden_docvault_content_identity.sql',
  import.meta.url,
);
const migration = readFileSync(migrationUrl, 'utf8');

test('DocVault migration enforces document and Purchase ownership equality', () => {
  assert.match(migration, /new\.user_id := v_purchase_user_id/);
  assert.match(migration, /document ownership does not match purchase ownership/);
  assert.match(migration, /document source ownership mismatch/);
  assert.match(migration, /existing document ownership mismatch requires review/);
});

test('DocVault migration makes stored hashed document identity immutable', () => {
  assert.match(migration, /if old\.content_sha256 is not null then/);
  assert.match(migration, /hashed document content identity is immutable/);
  assert.match(migration, /new\.storage_path is distinct from old\.storage_path/);
  assert.match(migration, /new\.provider_message_id is distinct from old\.provider_message_id/);
});

test('DocVault invoice RPC fails closed on same invoice number with different PDF bytes', () => {
  assert.match(migration, /v_document_content_sha256 is not null[\s\S]*document content hash conflict/);
  assert.match(migration, /if v_document_content_sha256 is null then/);
  assert.match(migration, /user_id,[\s\S]*purchase_id,[\s\S]*source_email_id,[\s\S]*content_sha256/);
});

test('DocVault privileged functions keep a locked search path and service-role-only surface', () => {
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function public\.controlled_upsert_invoice_attachment_document[\s\S]*from authenticated;/);
  assert.match(migration, /grant execute on function public\.controlled_upsert_invoice_attachment_document[\s\S]*to service_role;/);
});
