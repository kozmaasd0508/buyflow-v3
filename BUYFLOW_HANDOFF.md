# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-30 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Current architecture base:** `codex/v9-real-gmail-identity-shadow` @ `2e05b435a9f4fbc6467477c02fac462004bfa183`  
**Architecture PR:** #294 (draft) -> `codex/purchase-identity-v2-lifecycle-chain-gate`  
**Current extension branch:** `codex/modern-email-source-foundation-v1`  
**Extension PR:** #295 (draft) -> `codex/v9-real-gmail-identity-shadow`

## CURRENT STATE

BuyFlow remains safety-first and shadow-oriented for the new identity path:
- Purchase creation and lifecycle classification are separate decisions.
- AI/V9 semantics are non-authoritative for identity. AI cannot provide order/tracking/payment/invoice/merchant identity evidence.
- hard identifier conflicts fail closed to REVIEW/PENDING.
- lifecycle-only email cannot create a Purchase.
- automatic identity linking requires machine-readable hard evidence.
- no raw customer email bodies or identifiers are committed to the repository.
- no modern email-source migration has been applied live.
- no new provider has been cut over into production runtime.

## PURCHASE IDENTITY GRAPH V2 — ALREADY IMPLEMENTED

`apps/api/src/purchase-identity-v2/types.ts` already contains:
- `CanonicalEvent`
- `PurchaseIdentity`
- `OrderIdentity`
- `ShipmentIdentity`
- `PaymentIdentity`
- `InvoiceIdentity`
- `EvidenceEdge`
- `CorrelationDecision` (`NEW_PURCHASE`, `LINKED`, `REVIEW`, `PENDING`, `UNLINKED`)
- merchant identity definitions and explicit parent/child order relations.

Do not recreate these concepts under parallel names. Extend the existing graph contract.

V9 trust boundary:
- V9 supplies only primary lifecycle semantics.
- deterministic Extraction v2 supplies all identity values.
- invalid/mismatched V9 output fails closed.
- first merchant email may semantically be lifecycle-like while deterministic root evidence independently authorizes Purchase creation.

## MODERN EMAIL SOURCE FOUNDATION V1 — IMPLEMENTED ON PR #295

Core files include:
- `apps/api/src/email/document-v1.ts`
- `apps/api/src/email/normalize-document-v1.ts`
- `apps/api/src/email/authentication-v1.ts`
- `apps/api/src/email/link-extraction-v1.ts`
- `apps/api/src/email/structured-markup.ts`
- `apps/api/src/email/source-archive-v1.ts`
- `apps/api/src/email/incremental-provider.ts`
- `apps/api/src/email/gmail-incremental-provider.ts`
- `supabase/migrations/20260830203000_add_modern_email_source_foundation.sql`

The stable `NormalizedEmailDocumentV1` path provides:
- provider full plain text when available, otherwise deterministic HTML-to-text fallback;
- body HTML, headers and attachment metadata;
- bounded JSON-LD/schema.org extraction before AI;
- safe absolute HTTP(S) link extraction;
- fail-closed DKIM/SPF/DMARC normalization;
- immutable raw source reference + SHA-256 when raw bytes are available;
- immutable normalized JSON archive + SHA-256;
- opaque content-addressed object keys that do not expose provider message/user/connection ids;
- deterministic cross-pipeline trace id;
- retry-safe immutable-object verification.

Archive runtime wiring exists in `persistNormalizedInboundEmail(...)` but defaults OFF with `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false`.
When deliberately enabled after infrastructure deployment, it writes source/provenance metadata only; Purchase/Shipment/Document/AI write counters remain zero.

The migration adds raw + normalized object reference/hash/size/content-type/version/trace columns and defines private bucket `buyflow-email-source-v1`. It is committed only and has NOT been applied live.

## GMAIL INCREMENTAL PROVIDER V1 — IMPLEMENTED, NOT RUNTIME-WIRED

`GmailIncrementalEmailProvider` now implements the additive `IncrementalEmailProvider` contract using Gmail REST directly, without a new dependency:
- `messages.list` search + full `messages.get` normalization;
- full provider plain text + HTML + headers + attachment metadata;
- exact RAW MIME retrieval through `messages.get?format=raw` for source archiving;
- attachment byte download;
- initial sync captures Gmail `historyId` **before** snapshot scan so racing mailbox changes can be replayed instead of missed;
- incremental `history.list` change replay with created/updated/deleted dedupe;
- expired/invalid Gmail history cursor (404) -> `resetRequired=true`, never a guessed cursor;
- `watch` / renew / stop support for configured Google Pub/Sub topic;
- access token is supplied externally and never placed in URLs or diagnostics.

This class is not connected to user OAuth/runtime yet, so it cannot change live ingestion behavior.

## VERIFICATION STATUS

GitHub Actions CI **#1095** verified Gmail provider + source foundation code head:
`234cdb2b139dc245cfa0c30b3d8cd5a2a01b2646`

PASS:
- API typecheck
- API tests
- API build
- mobile typecheck
- mobile web build

The first Gmail CI attempt #1094 failed only on a strict optional test assertion (`message.headers` possibly undefined); that test typing was fixed without changing provider behavior, then #1095 passed fully.

Temporary main-targeting CI PR #296 is verification-only and must be closed without merge after the final exact-head documentation gate.

No Supabase migration has been applied live. No production provider/runtime/identity authority was changed.

## NEXT ACTION

Finish provider-source wiring without changing Purchase authority:
1. connect the existing Mailgun forwarded `.eml` exact bytes to the archive path when persistence is explicitly enabled;
2. add the Gmail OAuth/token/runtime adapter that supplies access tokens to `GmailIncrementalEmailProvider`, still behind a disabled feature flag;
3. persist provider cursor/watch state separately from Purchase identity state;
4. run synthetic + read-only Gmail smoke before any provider cutover;
5. only then consider enabling source archive/runtime for a controlled shadow account.

After provider ingestion is stable, persisted graph/review/projection tables must extend the existing Purchase Identity Graph v2 concepts instead of duplicating them.

## SAFETY RULES TO PRESERVE

- wrong automatic link/merge target: **0 tolerance**
- false Purchase creation: **0 tolerance**
- uncertainty -> REVIEW/PENDING/UNLINKED
- conflicting hard identifiers never auto-merge
- payment-only evidence cannot create Purchase authority
- provider/merchant identity alone is not hard order identity
- soft evidence may rank candidates but cannot independently auto-link
- AI semantic output never becomes hard identity evidence
- email content is untrusted data; AI has no write/link authority
- seller-outbound/return-to-seller evidence cannot create buyer Purchase authority
- future shipment/pre-advice is not physical shipment progress
- READY_FOR_PICKUP is not DELIVERED

## RESUME CONTRACT

Minimal resume phrase:
**Folytasd a BuyFlowot a GitHubból.**
