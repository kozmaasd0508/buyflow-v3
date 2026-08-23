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

### v1 -> v1.1
Base layers: auth/machine headers, semantic URL query/path, HTML semantics, JSON-LD/schema.org. v1.1 adds exact composite template tags and strict current-message English machine labels/lifecycle semantics.

Same six reviewed Gmail development cases:
- commerce-specific 3/6 -> 6/6
- explicit event 2/6 -> 6/6
- hard identifier 1/6 -> 3/6

### Broad ten-family development set
WooCommerce, UNAS, Shopify, GLS, MPL, FOXPOST, DPD, Billingo, Számlázz.hu, merchant invoice + PDF.

v1.2 added audited platform/provider semantics without weakening global matching:
- WooCommerce multi-primitive DOM + stable order-label -> order identity only, never lifecycle authority
- UNAS exact X-Mailer action discrimination
- Shopify multi-signal transport/template fingerprint -> platform evidence only
- official Posta tracking namespace/path + `ids` -> MPL tracking identity
- exact `X-Szamlazz-Invoice` -> namespaced invoice identity + invoice event

v1.2 broad development result:
- auth/transport 10/10
- commerce-specific 6/10
- explicit event 3/10
- hard identifier 4/10

### v1.4
Added:
- strict PDF invoice TechnicalEvidence built on existing deterministic `unpdf` + invoice attachment parser
- authenticated DPD parcel/lifecycle semantic adapter
- authenticated FOXPOST parcel/lifecycle semantic adapter
- provider-qualified GLS COD payment-receipt PDF evidence
- QR semantic preflight

Same ten-family development result after v1.4:
- auth/transport **10/10**
- commerce-specific **9/10**
- explicit event **6/10**
- hard identifier **7/10**

Extended 11-family slice including the separately reviewed GLS COD-receipt PDF:
- commerce-specific **10/11**
- explicit event **7/11**
- hard identifier **8/11**

These are development coverage figures, NOT blind precision/recall or production accuracy claims.

### Important new findings

- DPD: the stable parcel number can be namespaced from authenticated DPD notification semantics; opaque myDPD `code=` remains explicitly non-identity.
- FOXPOST: the same exact FOXPOST parcel id survives pre-advice -> warehouse -> ready-for-pickup. Pre-advice proves parcel identity may exist before physical handoff, so pre-advice yields identity but no shipment event.
- FOXPOST ready-for-pickup may expose a separate labelled Packeta identifier; keep namespaces separate.
- PDF invoice: verified invoice + order references become separate `source=pdf` hard evidence, never flattened into generic body claims.
- GLS COD receipt PDF: verified receipt text can expose parcel identity + payment reference + amount/currency under GLS/GLS_COD namespaces.
- QR preflight: a reviewed FOXPOST QR payload equals the visible pickup/opening code, NOT the parcel/tracking id. Do not build generic QR-to-tracking extraction. A future QR layer may only provide `pickup_code` corroboration.
- Shopify remains the only unsupported commerce-specific family in the original ten-case slice. Platform fingerprint alone still does not grant lifecycle authority.

### New modules / reports

- `apps/api/src/extraction-v2/technical-evidence-pdf-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-v1.test.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.test.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-payment-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-payment-v1.test.ts`
- `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V14-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-QR-PREFLIGHT-2026-08-23.md`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when GitHub/Supabase can recover it. Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return/refund emails into one safe Purchase record.

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

Do NOT loosen Shopify from one merchant example. First inspect multiple independent Shopify commerce templates for stable machine-level lifecycle discriminators. In parallel, broaden PDF/provider measurement families. Then run full repository typecheck/tests when a CI-capable target is available and freeze a fresh untouched broad holdout before any generalization/accuracy claim.
