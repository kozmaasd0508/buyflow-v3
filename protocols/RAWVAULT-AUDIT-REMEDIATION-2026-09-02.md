# RawVault audit remediation — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Role

RawVault owns immutable source evidence storage only:
- exact original provider/MIME bytes when available;
- versioned normalized source document;
- integrity hashes, opaque object keys, retention metadata and traceability;
- retry/orphan/account-deletion cleanup state;
- zero Purchase/Shipment/Document/Identity authority.

## Audit blockers found

The first module audit found these production blockers:
1. Storage objects could outlive a deleted `source_emails`/user row with no cleanup journal.
2. `raw_retention_until` was metadata only; no worker enforced deletion.
3. Object upload happened before the DB source row, so crash/DB failure could leave untracked orphan objects.
4. A deduped provider message id returned before raw-byte integrity comparison, so changed bytes under the same provider id were not detected.
5. Empty raw bytes were accepted.
6. An already-expired retention timestamp was accepted.
7. Normalized JSON retained full personal email content but had no separate retention boundary.
8. Archive object/hash/retention metadata was not DB-level immutable.

## Remediation

Behavior code head verified by CI:  
`9480e6d4e8d5c3e0a771b43671503cda593971c2`

Implemented:
- archive artifacts are fully prepared and hashed before any object write;
- an opaque durable `email_source_archive_manifests` row is staged before object writes;
- manifest identity is a full SHA-256 plus deterministic opaque trace UUID and stores no user id, provider message id, subject or body;
- raw + normalized object metadata is immutable in the manifest and in `source_emails` via DB triggers;
- raw and normalized documents have separate explicit retention boundaries;
- archive writes fail closed unless both retention policies are explicitly configured (`BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS`, `BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS`); no duration is guessed in code;
- raw bytes must be non-empty and retention boundaries must be valid future timestamps;
- retry of an already-archived provider message checks incoming raw SHA-256 against the stored raw hash and fails closed on mismatch;
- source-row insert failure leaves the staged manifest as the crash-safe cleanup/retry journal instead of relying on best-effort immediate deletion;
- periodic RawVault maintenance reconciles pending manifests, heals source-row/manifest commit races, deletes stale orphan objects, enforces raw/normalized retention independently, and removes objects when the source row disappears (including user/account cascade deletion);
- deletion timestamps are recorded while immutable hashes/object identities stay audit-preserved;
- the private Supabase bucket remains unchanged and archive stays OFF by default.

Migration added:
`supabase/migrations/20260902115500_harden_email_source_archive_v1.sql`

## Regression coverage

Added/updated tests cover:
- immutable opaque raw + normalized archive keys/hashes;
- explicit raw + normalized retention;
- empty raw rejection;
- expired/invalid retention rejection before object writes;
- retry idempotency;
- manifest staging/commit before source provenance completion;
- same-provider-id changed raw bytes -> immutable conflict;
- committed source-row deletion -> raw + normalized object cleanup;
- stale pending orphan cleanup;
- raw retention deletion independent of normalized retention;
- pending manifest healing when matching source row already exists.

## CI evidence

Temporary CI-only PR #296 / GitHub Actions CI #1147 on exact behavior head `9480e6d4e8d5c3e0a771b43671503cda593971c2`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

## Safety/deployment state

Unchanged:
- `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false` by default;
- no source/archive migration applied live from this flow;
- no provider production cutover;
- no raw customer email committed to Git;
- Purchase/Shipment/Document/Identity write authority unchanged;
- AI identity authority remains zero.

## Verdict

**RawVault code audit remediation: PASS.**

**Production RawVault: BLOCKED** until the additive migrations are applied in controlled staging, explicit retention values are chosen/configured, private bucket/object permissions are verified live, retention/orphan maintenance is smoke-tested against real storage, and the source path is enabled only for a controlled shadow account.

Next module audit: **MailLens**.
