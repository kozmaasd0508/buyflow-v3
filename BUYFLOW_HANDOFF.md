# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-30 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current architecture base:** `codex/v9-real-gmail-identity-shadow` @ `2e05b435a9f4fbc6467477c02fac462004bfa183`  
**Architecture PR:** #294 (draft) -> `codex/purchase-identity-v2-lifecycle-chain-gate`  
**Current extension branch:** `codex/modern-email-source-foundation-v1`

## CURRENT STATE

BuyFlow remains safety-first and shadow-oriented for the new identity path:
- Purchase creation and lifecycle classification are separate decisions.
- AI/V9 semantics are non-authoritative for identity. AI cannot provide order/tracking/payment/invoice/merchant identity evidence.
- hard identifier conflicts fail closed to REVIEW/PENDING.
- lifecycle-only email cannot create a Purchase.
- automatic identity linking requires machine-readable hard evidence.
- no raw customer email bodies or identifiers are committed to the repository.
- the new email-source foundation has no runtime/provider cutover and no production DB migration applied yet.

## PURCHASE IDENTITY GRAPH V2 — ALREADY IMPLEMENTED IN CODE

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

Do not recreate these concepts under new parallel names. Extend the existing graph contract.

V9 trust boundary in PR #294:
- V9 supplies only primary lifecycle semantics.
- deterministic Extraction v2 supplies all identity values.
- invalid/mismatched V9 output fails closed.
- first merchant email may semantically be lifecycle-like while deterministic root evidence independently authorizes Purchase creation.

Documented semantic benchmark in PR #294: 95/102 = 93.14% on the sanitized real-email HOLDOUT. Strict end-to-end identity claims are intentionally narrower because most sanitized messages do not preserve meaningful sender-domain authority.

## MODERN EMAIL SOURCE FOUNDATION V1 — STARTED

New additive files on `codex/modern-email-source-foundation-v1`:
- `apps/api/src/email/document-v1.ts`
- `apps/api/src/email/document-v1.test.ts`
- `apps/api/src/email/incremental-provider.ts`
- `supabase/migrations/20260830203000_add_modern_email_source_foundation.sql`

The new `NormalizedEmailDocumentV1` contract adds:
- `bodyText` + `bodyHtml`
- complete headers/attachments
- structured-data records (JSON-LD / schema-style sources)
- extracted links
- DKIM/SPF/DMARC verdict slots
- immutable raw-source object reference + SHA-256
- normalizer version
- cross-pipeline `traceId`.

The legacy `NormalizedEmail` contract is not removed. `upgradeNormalizedEmailToDocumentV1(...)` is a fail-closed compatibility adapter and never invents unavailable evidence.

`IncrementalEmailProvider` is additive only. It defines initial sync, cursor-based change retrieval and watch lifecycle so Gmail can later use `watch + historyId/history.list` and Outlook can later use notification + delta semantics without changing downstream ingestion.

The SQL migration only adds metadata columns to `source_emails` for object-storage references/integrity/version/trace. Raw provider/MIME bytes are intentionally not stored inline in Postgres.

## VERIFICATION STATUS

Do **not** claim this new foundation passes yet.

Current extension branch has not yet completed its required CI gate after the 2026-08-30 changes.

Required gate before promotion:
1. draft PR from `codex/modern-email-source-foundation-v1` to `codex/v9-real-gmail-identity-shadow`;
2. API typecheck;
3. API tests;
4. API build;
5. mobile typecheck;
6. mobile web build.

No Supabase migration should be applied live until the branch is reviewed and CI is green.

## NEXT ACTION AFTER GREEN CI

Implement the first real runtime slice behind shadow/read-only behavior:
1. immutable raw-email object writer (object storage, SHA-256, content type, byte size);
2. provider-to-`NormalizedEmailDocumentV1` normalizer;
3. JSON-LD/Schema.org structured-data extraction before AI;
4. persist only raw/normalized object references and provenance metadata;
5. keep Purchase/Identity writes disabled in this slice.

After that, add first-class persisted graph/review/projection tables only by extending the existing Purchase Identity Graph v2 concepts; do not duplicate the already-implemented in-memory types.

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
