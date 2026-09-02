# DocVault audit — 2026-09-02

## Verdict

**Code / document-safety audit: PASS.**

Production/staging database application remains **BLOCKED**. The new migration was prepared as source code only and was not applied from this audit.

## Real issues found

1. **Same invoice identity could replace a stored PDF.**
   `controlled_upsert_invoice_attachment_document` updated storage path and SHA-256 on an existing invoice row. A later different PDF with the same Purchase + invoice number could therefore silently replace the stored document identity.

2. **Attachment storage path was not content-addressed.**
   The path depended on user/source/attachment identity while storage used `upsert: true`. After an interrupted run, changed bytes behind the same provider attachment identity could overwrite the old object before database verification.

3. **Fresh document inserts could miss required ownership.**
   `documents.user_id` is NOT NULL in the base schema, while legacy controlled document insert functions did not populate it directly. A fresh schema path could therefore reject a new document insert.

4. **API document reads relied on Purchase scoping only.**
   The Purchase was correctly user-scoped, but the admin-client document query did not independently filter `documents.user_id`. This was hardened as defense in depth before signed URL creation.

## Remediation

### Content-addressed attachment storage

`apps/api/src/ingestion/invoice-attachment-recovery-v1.ts`

- storage path now includes the full PDF SHA-256;
- same provider attachment identity with a different known SHA-256 is moved to REVIEW before storage overwrite;
- identical retries stay idempotent;
- malformed hashes are rejected before path creation.

### Database ownership + immutable content identity

Prepared migration:

`supabase/migrations/20260902162000_harden_docvault_content_identity.sql`

It adds:
- a document ownership trigger that fills missing `user_id` from the owning Purchase and rejects cross-user mismatch;
- source-email ownership validation when `source_email_id` exists;
- fail-closed preflight for any already-existing cross-user document row;
- an immutability trigger for hashed documents;
- a hardened `controlled_upsert_invoice_attachment_document` RPC;
- same invoice + different SHA-256 -> hard conflict;
- a body-only document placeholder may be upgraded once to a physical PDF;
- after SHA-256 exists, physical provenance/storage identity is not silently replaced;
- privileged functions use locked `search_path` and service-role-only RPC access.

### API read scope

`apps/api/src/api/app-routes.ts`

Both document list/detail queries now explicitly apply:

`documents.user_id = authenticated user.id`

The Purchase itself remains user-scoped first, private stored PDFs remain signed only after that lookup, signed URLs remain short-lived, and the response remains `Cache-Control: no-store`.

## Tests

Added:
- `apps/api/src/ingestion/invoice-attachment-recovery-v1.test.ts`
- `apps/api/src/ingestion/docvault-content-identity-migration.test.ts`
- `apps/api/src/api/docvault-api-scope.test.ts`

They cover:
- content-addressed path stability;
- changed-byte conflict detection;
- malformed SHA rejection;
- Purchase/document ownership enforcement in the migration;
- hashed document immutability;
- same invoice/different PDF conflict behavior;
- locked privileged surface;
- explicit authenticated-user filtering before document URL signing.

## Verification

Verified behavior head:
`e77a226f403c6d5141e91d32d277bc99ce91ac21`

Temporary CI-only draft PR: **#307** — closed unmerged.

GitHub Actions:
- CI **#1184**
- run `33652929490`
- API typecheck: PASS
- API tests: PASS
- API build: PASS
- mobile typecheck: PASS
- mobile web build: PASS
- EventMind runtime/launcher syntax: PASS

## Deployment status

- migration `20260902162000_harden_docvault_content_identity.sql`: **NOT APPLIED**;
- no production document migration was performed;
- no provider cutover was performed;
- no AI identity authority was added;
- production document write semantics remain conservative until controlled staging migration/smoke.

## Next module

**Core**.
