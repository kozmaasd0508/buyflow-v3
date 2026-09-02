# BuyFlow worklog latest

## 2026-09-02 — EventMind authority/input boundary remediated; code CI GREEN

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

EventMind was the fourth module in the full BuyFlow audit. The audit covered the current V11 Qwen reference, prompt/output ontology, 18 lifecycle labels, decoder, model-input representation and all direct/indirect paths by which AI semantics might influence Purchase identity.

Remediation:
- added `apps/api/src/ai/eventmind-v1.ts` as the production-side EventMind contract;
- EventMind now has one MailLens-only input builder consuming already-normalized `NormalizedEmailDocumentV1` instead of reparsing provider body/HTML;
- only current `semanticText`, sender/subject/time, quote/truncation flags and bounded structured lifecycle hints enter the model view;
- provider/thread ids, recipients, snippet, full body, raw HTML, raw auth/header data, folders, links, attachments, raw archive refs, trace ids and internal Purchase candidate/id values are excluded;
- common identity-bearing structured keys and URLs are removed while status/state hints remain;
- added explicit semantic-only prompt contract denying create/link/merge/select/identify Purchase authority;
- fixed 18-event taxonomy is shared through a generic semantic-event overlay;
- strict EventMind decoder accepts exactly `is_commerce` + `event_type`, rejects extra identity fields, invalid labels and commerce/event incoherence;
- V9 overlay remains backwards compatible through the shared semantic-only contract;
- semantic override continues to contain only event semantics + model provenance, never identity fields;
- existing deterministic Purchase Identity Graph creation/link/conflict gates are unchanged and remain authoritative.

Regression coverage verifies:
- stale quoted lifecycle history cannot enter EventMind current semantics;
- stale snippet cannot bypass MailLens;
- provider/archive/header/attachment/private identity metadata cannot enter the model view;
- structured order/tracking identity values/URLs are removed while lifecycle status hints remain;
- taxonomy is exactly 18 labels;
- attempted model `purchase_id` output is `INVALID_SCHEMA`;
- invalid/incoherent output fails closed;
- successful V11 decode maps only to semantic override keys.

Exact behavior code head:
`1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`

Temporary CI-only PR #303 / GitHub Actions CI #1152, run `33632992124`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #303 was closed unmerged after verification.

Protocol:
`protocols/EVENTMIND-AUDIT-2026-09-02.md`

Verdict:
- **EventMind code contract / identity-authority remediation: PASS**
- **Production EventMind runtime: BLOCKED**

Remaining production blockers:
- wire actual V11 only through the new MailLens/EventMind input + strict decoder;
- pin base model/tokenizer/template and adapter SHA instead of mutable `LATEST.txt` selection;
- explicitly disable thinking with no silent tokenizer-template fallback;
- model unavailable/OOM/timeout/invalid output must fail closed;
- run a new untouched representation gate on the exact MailLens/EventMind V1 input; the prior 180-case SemanticEmailView A/B is diagnostic only;
- add privacy-safe runtime model/version/latency/failure observability.

Safety unchanged: no Qwen runtime was enabled, source/live flags remain OFF, `aiCalls` in the normalized inbound source lane remain zero, and no Purchase/Shipment/Document/Identity authority changed.

Next: prepare the exact V11 runtime integration + untouched MailLens/EventMind V1 representation gate; after clean runtime evidence continue with **TrustLink**.

---

## 2026-09-02 — MailLens blockers remediated; code CI GREEN

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

MailLens was the third module in the full BuyFlow audit. Its initial audit found representation drift, plain-text body loss, MIME attachment contamination, hidden/quoted stale-content risk, unauthenticated auth-header trust ambiguity and structured-data bounds/provenance gaps.

Remediation:
- `NormalizedEmailDocumentV1` now has bounded full `bodyText`, separate current `semanticText`, and explicit normalization metadata;
- normalizer version is `normalized-email-document-v1.1`;
- full provider plain text is preferred; rendered HTML is fallback; snippet is last resort;
- candidate gating, deterministic parsing, legacy `EmailDocumentV1`, normalized inbound universal semantics and diagnostic identity shadow use the canonical MailLens semantic view;
- raw HTML remains preserved in source/archive, while legacy semantic consumers do not receive raw HTML and therefore cannot bypass MailLens hidden/quote filtering;
- common hidden/preheader HTML is removed from derived semantic text while source HTML stays untouched;
- strong quoted/reply history is excluded from current semantic text while remaining in full body evidence;
- Gmail named/attachment-disposition text/HTML parts no longer enter authored message body; detached real body parts still hydrate;
- raw auth headers are diagnostic-only with `trusted:false` + provenance;
- JSON-LD traversal is iterative/bounded; raw JSON parse is preferred; entity compatibility fallback is provenance-tagged;
- microdata itemtype is explicitly type-hint-only (`fieldEvidence:false`), not field evidence;
- truncation is explicit rather than silent;
- link/structured compatibility paths gained numeric entity handling.

Regression coverage includes:
- plain-text-only commerce with stale/short snippet;
- Gmail privacy candidate acceptance based on full plain body;
- hidden stale preheader;
- quoted old lifecycle state;
- text attachment injection;
- detached body hydration;
- auth spoof/conflict/Received-SPF provenance;
- raw vs compatibility JSON-LD provenance;
- deep JSON-LD bound safety;
- explicit truncation and microdata type-hint semantics.

Exact behavior code head:
`f69195404831323f2783464a61f6f7b7435698b5`

Temporary CI-only PR #296 / GitHub Actions CI #1151, run `33631564933`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

Protocol:
`protocols/MAILLENS-AUDIT-2026-09-02.md`

Verdict:
- **MailLens code audit remediation: PASS**
- **Production source path: BLOCKED** pending controlled MailGate real-Gmail and RawVault staging/storage/retention gates.

Safety unchanged:
- source/runtime flags remain OFF by default;
- no live migration or provider cutover;
- no Purchase/Shipment/Document/Identity authority change;
- AI remains non-authoritative for identity.

Next: **EventMind** full code/model/prompt/runtime audit against MailLens v1.1. Current reference semantic model remains V11; V12 is not promoted after its untouched post-training holdout regression.

---

## 2026-09-02 — RawVault audit blockers remediated; code CI GREEN

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

RawVault was audited as the second module in the full BuyFlow audit. The first pass found production blockers around retention enforcement, object/DB crash consistency, account-deletion cleanup, dedupe integrity and metadata immutability.

Remediation:
- immutable raw + normalized artifacts are fully prepared and hashed before object writes;
- an opaque durable `email_source_archive_manifests` row is staged before any object write;
- manifest identity uses SHA-256 + deterministic trace UUID and stores no user id, provider message id, subject or body;
- source-row insert failure leaves a durable pending manifest for retry/orphan cleanup instead of untracked Storage objects;
- same provider message id now verifies incoming raw SHA-256 against the stored raw hash and fails closed on mismatch;
- empty raw bytes are rejected;
- invalid or already-expired retention boundaries are rejected before object writes;
- raw and normalized documents have separate explicit retention boundaries;
- no retention duration is guessed: archive writes require explicit `BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS` and `BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS`;
- periodic RawVault maintenance heals pending/committed races, deletes stale pending orphans, enforces raw/normalized retention independently, and removes archived objects after source/user cascade deletion;
- DB triggers make archive object identity/hash/retention metadata immutable while deletion timestamps remain writable for audit;
- private bucket and all source/live flags remain unchanged/off by default.

Migration:
`supabase/migrations/20260902115500_harden_email_source_archive_v1.sql`

Regression coverage added/updated for:
- opaque immutable archive keys/hashes;
- retry idempotency;
- explicit raw + normalized retention;
- empty raw rejection;
- expired/invalid retention rejection;
- manifest stage/commit flow;
- changed raw bytes under same provider id -> conflict;
- stale orphan cleanup;
- source/user deletion cleanup;
- independent raw retention deletion;
- pending manifest healing.

Exact behavior code head:
`9480e6d4e8d5c3e0a771b43671503cda593971c2`

Temporary CI-only PR #296 / GitHub Actions CI #1147:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

Protocol:
`protocols/RAWVAULT-AUDIT-REMEDIATION-2026-09-02.md`

Verdict:
- **RawVault code audit remediation: PASS**
- **Production RawVault: BLOCKED** pending controlled staging migration, explicit retention policy configuration, live private-storage cleanup smoke and source enablement only for a controlled shadow account.

---

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

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke foundation

Implemented direct Gmail OAuth/PKCE, encrypted refresh-token storage, separate cursor/watch state, CAS cursor commits, personal-mailbox positive-commerce privacy gate, authenticated Pub/Sub wake-up path, durable sync inbox with retry/dead-letter, and a read-only shadow smoke command. All live flags remained OFF and no production cutover occurred.

Historical verification before the 2026-09-02 audit remediation: CI #1132 GREEN on code head `30bd9baaf64bd5f2660ee223f1d54ed8994a49db`.

---

## 2026-08-30 — Modern email source archive + rich normalizer v1

Added `NormalizedEmailDocumentV1`, structured markup/link/auth extraction, immutable raw + normalized object archive with SHA-256/opaque keys, additive source metadata migration, and disabled-by-default archive wiring. Historical CI #1092 GREEN.
