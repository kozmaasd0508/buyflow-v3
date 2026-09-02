# BuyFlow worklog latest

## 2026-09-02 — MailGate direct-Gmail audit blockers remediated; code CI GREEN

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

The module-by-module BuyFlow audit started with MailGate. The direct-Gmail source path was reviewed against a strict source-only contract and several production blockers were found and fixed.

Behavior fixes:
- durable initial sync now exhausts the entire configured discovery-query snapshot before committing the captured Gmail history cursor; bounded smoke sampling remains separate;
- large `text/plain` / `text/html` Gmail body parts stored behind `attachmentId` are hydrated through `attachments.get` before normalization;
- invalid/missing `internalDate` no longer becomes 1970; valid `Date` header is fallback, otherwise fail closed;
- transient network/408/429/5xx Gmail reads use bounded retry and `Retry-After` handling;
- full-message fetch fan-out is concurrency bounded;
- expired `historyId` automatically triggers a complete recovery snapshot and commits the replacement cursor only after safe source handling;
- automatic watch renewal plus periodic cursor-based fallback sync were added, so a missed Pub/Sub push or expiring watch cannot silently stop source ingestion;
- OAuth now rejects unexpected extra Gmail authority, including Gmail write scopes and broad `https://mail.google.com/` authority.

Regression coverage added/updated for:
- complete initial pagination despite a small page size;
- detached body hydration;
- timestamp fallback/fail-closed behavior;
- retryable Gmail API response;
- extra Gmail OAuth authority rejection.

Exact behavior code head:
`e67b908e07d072e3737611eca4ee804d7d905c26`

Temporary CI-only PR #296 / GitHub Actions CI #1142:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

Protocol:
`protocols/MAILGATE-DIRECT-GMAIL-AUDIT-REMEDIATION-2026-09-02.md`

Safety unchanged:
- direct Gmail runtime OFF by default;
- source archive OFF by default;
- Mailgun source persistence OFF by default;
- no production cutover;
- no live migration application from this flow;
- Purchase/Shipment/Document writes remain zero in direct-Gmail source lane;
- AI has zero identity authority;
- Pub/Sub remains wake-up metadata only.

Verdict:
- **MailGate code audit remediation: PASS**
- **Production MailGate: BLOCKED pending controlled real-Gmail read-only shadow smoke**

Next: keep flags OFF; run controlled `gmail:direct-shadow-smoke` only when staging Google/Supabase credentials are available. Continue module audit with RawVault in parallel; do not treat earlier source-archive CI as a completed RawVault audit.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke foundation

Implemented direct Gmail OAuth/PKCE, encrypted refresh-token storage, separate cursor/watch state, CAS cursor commits, personal-mailbox positive-commerce privacy gate, authenticated Pub/Sub wake-up path, durable sync inbox with retry/dead-letter, and a read-only shadow smoke command. All live flags remained OFF and no production cutover occurred.

Historical verification before the 2026-09-02 audit remediation: CI #1132 GREEN on code head `30bd9baaf64bd5f2660ee223f1d54ed8994a49db`.

---

## 2026-08-30 — Modern email source archive + rich normalizer v1

Added `NormalizedEmailDocumentV1`, structured markup/link/auth extraction, immutable raw + normalized object archive with SHA-256/opaque keys, additive source metadata migration, and disabled-by-default archive wiring. Historical CI #1092 GREEN. RawVault/MailLens still require the new module-level audit before any PASS verdict.
