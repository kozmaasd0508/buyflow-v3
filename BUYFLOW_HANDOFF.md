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
- no provider runtime cutover has occurred.

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

Core files now include:
- `apps/api/src/email/document-v1.ts`
- `apps/api/src/email/normalize-document-v1.ts`
- `apps/api/src/email/authentication-v1.ts`
- `apps/api/src/email/link-extraction-v1.ts`
- `apps/api/src/email/structured-markup.ts`
- `apps/api/src/email/source-archive-v1.ts`
- `apps/api/src/email/incremental-provider.ts`
- `supabase/migrations/20260830203000_add_modern_email_source_foundation.sql`

The stable `NormalizedEmailDocumentV1` path now provides:
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

Archive runtime wiring exists in `persistNormalizedInboundEmail(...)` but is disabled by default with `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false`.
When explicitly enabled after infrastructure deployment, it writes only source/provenance metadata; Purchase/Shipment/Document/AI write counters remain zero.

The migration adds raw + normalized object reference/hash/size/content-type/version/trace columns and defines private bucket `buyflow-email-source-v1`. It is committed only and has NOT been applied live.

## VERIFICATION STATUS

GitHub Actions CI **#1092** verified code head:
`1f1ae0023d695f8e3b21bb4ebcde249714d358de`

PASS:
- API typecheck
- API tests
- API build
- mobile typecheck
- mobile web build

Temporary main-targeting CI PR #296 was reopened only for verification and closed again without merge.
Documentation updates followed that verified code head; run the normal exact-head CI gate again after the final handoff/worklog commit before claiming the whole PR head green.

No Supabase migration has been applied live. No production provider/runtime/identity authority was changed.

## NEXT ACTION

Connect real provider source acquisition to the stable document/archive contract without changing Purchase authority:
1. inventory each provider's actual available source bytes/body/headers;
2. wire the safest existing raw source path first (Mailgun forwarded `.eml` already exposes exact bytes in shadow);
3. keep archive flag off by default and preserve zero Purchase/Identity writes;
4. add Gmail first-class incremental provider behind `IncrementalEmailProvider` (`watch + historyId/history.list`) after source acquisition contracts are proven;
5. do not use Nylas/provider snippet as a substitute for raw/full content when richer source is available.

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
