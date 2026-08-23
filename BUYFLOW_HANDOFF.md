# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-08-23 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Active development base:** `codex/mailgun-inbound-shadow-v3`  
**TechnicalEvidence work:** PR #256 / `codex/technical-evidence-shadow-v1`

## CURRENT TECHNICALEVIDENCE STATE — 2026-08-23

TechnicalEvidence remains a separate observational lane. It is NOT wired into production extraction, Purchase Identity Graph decisions, DB mutation, or automatic linking.

Hard invariants:
- `mode=shadow`
- production writes = 0
- AI calls = 0
- frozen Extraction Engine v2 unchanged
- Purchase Identity Graph v2 decision authority unchanged
- no raw Gmail values in repo-safe measurement reports

### v1
Base layers: auth/machine headers, semantic URL query/path, HTML semantics, JSON-LD/schema.org.
Six-case development result: auth 6/6, commerce-specific 3/6, event 2/6, hard identifier 1/6.

### v1.1
Adds exact composite template tags and strict current-message English machine labels/lifecycle semantics. Quoted history and bare generic IDs remain blocked.
Six-case remeasurement: commerce-specific 6/6, event 6/6, hard identifier 3/6.

### Broad ten-case development set
WooCommerce, UNAS, Shopify, GLS, MPL, FOXPOST, DPD, Billingo, Számlázz.hu, merchant invoice + PDF.

v1.1 broad result: commerce-specific 3/10, event 2/10, hard identifier 1/10.

### v1.2
Adds audited platform/provider semantics without weakening global matching:
- WooCommerce multi-primitive DOM + `Order #...` -> order identity only, never lifecycle authority
- UNAS exact X-Mailer action discrimination: `/shop_order_send.php` can prove order-confirmation event; `/admin_order_det.php` does not
- Shopify multi-signal transport/template fingerprint -> platform evidence only
- official Posta tracking namespace/path + `ids` -> MPL tracking identity
- exact `X-Szamlazz-Invoice` -> namespaced invoice identity + invoice event

Broad v1.2 development result:
- auth/transport 10/10
- commerce-specific 6/10
- event 3/10
- hard identifier 4/10

These are development coverage figures, not accuracy/generalization claims.

### Remaining gaps
1. FOXPOST dual identifiers + redirect-wrapped URLs + QR payload
2. DPD authenticated template semantics; opaque myDPD `code` must never be tracking
3. PDF TechnicalEvidence using the existing PDF text extraction stack
4. stronger Shopify lifecycle discriminator only if stable machine evidence is proven
5. then broader development rerun and finally a new untouched blind set

Measurement docs:
- `protocols/TECHNICAL-EVIDENCE-REAL-GMAIL-MEASUREMENT-V1-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-REAL-GMAIL-MEASUREMENT-V11-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V11-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V12-2026-08-23.md`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when GitHub/Supabase can recover it. Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return/refund emails into one safe Purchase record.

- frontend/mobile web: `apps/mobile`
- backend: TypeScript under `apps/api`
- production data: Supabase
- email: Nylas v3 webhook + durable/targeted scans + normalized inbound paths
- recognition: deterministic-first; ambiguity => REVIEW
- AI intentionally disabled in production recognition

Target research flow:
```text
RAW EMAIL
  -> multi-layer TechnicalEvidence
  -> CanonicalEvent
  -> Purchase Identity Graph
  -> lifecycle projection
```

TechnicalEvidence observes; it never directly grants unsafe merge authority. Identity remains namespace-scoped and strict.

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. Hard identifiers are namespace-scoped; contradictory hard identity => REVIEW.
5. No generic domain+time fallback.
6. Platform/provider/relay identity alone cannot establish merchant identity.
7. Packing, label creation and pre-advice do not prove physical shipment.
8. Future/conditional fulfillment wording does not prove current state.
9. OUT_FOR_DELIVERY / READY_FOR_PICKUP are not DELIVERED.
10. Payment-only email cannot create a Purchase.
11. Generic machine params such as `id`, `ids`, `code`, `ref` have no identity meaning without exact typed/provider context.
12. Raw evidence can contain private identifiers; repo-safe reports contain only opaque ids/status/aggregates.
13. Production protocol activation remains explicit; research/shadow evidence has no automatic write authority.

## NEXT HIGH-VALUE TASK

Build PDF TechnicalEvidence first using the existing PDF text extraction stack. Then add exact authenticated FOXPOST and DPD technical adapters, rerun the same broad development set, and only then create a new untouched blind holdout.
