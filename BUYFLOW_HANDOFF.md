# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-08-23 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Active development base:** `codex/mailgun-inbound-shadow-v3`  
**TechnicalEvidence work:** PR #256 / `codex/technical-evidence-shadow-v1`

## CURRENT TECHNICALEVIDENCE STATE

TechnicalEvidence is still a separate observational lane. It is NOT wired into production extraction, Purchase Identity Graph decision authority, DB mutation, or automatic linking.

Hard invariants:
- `mode=shadow`
- production writes = 0
- AI calls = 0
- frozen Extraction Engine v2 unchanged
- Purchase Identity Graph v2 decision authority unchanged
- no raw Gmail values in repo-safe reports

### Layer coverage built so far

- MIME/authentication headers
- semantic URL path/query evidence
- HTML title/class/id/data/alternate-text semantics
- JSON-LD/schema.org
- strict current-message alternate English semantics
- WooCommerce multi-primitive order identity
- UNAS generator/action semantics
- MPL provider-qualified tracking URL semantics
- Számlázz.hu dedicated invoice header
- PDF invoice evidence using existing deterministic `unpdf` stack
- provider-qualified GLS COD receipt PDF evidence
- authenticated DPD lifecycle/parcel semantics
- authenticated FOXPOST lifecycle/dual-id semantics
- native Shopify transactional semantics
- QR preflight: pickup-code corroboration only, never generic tracking

### Development progression

Same six reviewed Gmail cases:
- v1 commerce-specific 3/6, event 2/6, hard id 1/6
- v1.1 commerce-specific 6/6, event 6/6, hard id 3/6

Original ten-family development slice (WooCommerce, UNAS, Shopify, GLS, MPL, FOXPOST, DPD, Billingo, Számlázz.hu, merchant invoice/PDF):
- v1.2: commerce-specific 6/10, event 3/10, hard id 4/10
- v1.4: commerce-specific 9/10, event 6/10, hard id 7/10
- v1.5 Shopify development projection: commerce-specific **10/10**, event **7/10**, merchant-scoped/namespaced id **8/10**

Extended 11-family slice adding the separately reviewed GLS COD receipt PDF:
- commerce-specific **11/11**
- event **8/11**
- merchant-scoped/namespaced id **9/11**

These are development coverage figures only, NOT blind precision/recall or production accuracy.

### Shopify v1.5 finding

Two independent real merchants now prove the same native Shopify order-confirmation stack:
- `mailer.shopify.com` transport plus an independent Shopify authentication/message signal;
- standard Shopify transactional order DOM (`order-list__product-image` plus corroborating template primitive/CDN);
- explicit current-message order reference;
- explicit current-message confirmation semantics.

The new adapter requires all of those layers before emitting order/lifecycle evidence. Shopify assets alone are insufficient. A merchant custom/Amazon SES email that still contains Shopify assets receives no native Shopify lifecycle authority. Shopify login/security mail also fails closed.

Order number is merchant-scoped when storefront scope is recoverable. Native shipment/delivery evidence remains marked as reviewed from only one independent merchant lifecycle family. Tracking captured from Shopify remains without carrier namespace and cannot hard-merge to a carrier Shipment until carrier namespace is resolved independently.

### Important safety findings retained

- DPD opaque myDPD `code=` is not tracking identity.
- FOXPOST pre-advice yields parcel identity but no physical shipment event.
- FOXPOST/Packeta identifiers remain separate namespaces.
- PDF filename alone is never proof.
- QR payload from the reviewed FOXPOST message equals pickup/opening code, not tracking id.
- platform/provider identity alone cannot establish merchant identity.
- future/conditional fulfillment wording cannot prove current lifecycle state.

## CURRENT MODULES / REPORTS

Key new shadow modules:
- `apps/api/src/extraction-v2/technical-evidence-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-v1-1.ts`
- `apps/api/src/extraction-v2/technical-evidence-v1-2.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-payment-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-shopify-v1.ts`
- matching `.test.ts` files

Latest reports:
- `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V14-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-QR-PREFLIGHT-2026-08-23.md`
- `protocols/TECHNICAL-EVIDENCE-SHOPIFY-DEVELOPMENT-PREFLIGHT-2026-08-23.md`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when GitHub/Supabase can recover it. Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / TARGET FLOW

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

Do not tune further on the reviewed development families. First run repository typecheck/tests when a CI-capable target is available, then freeze a completely new untouched broad holdout. The next unbiased gate must explicitly contain commerce plus hard-noise families, including Shopify security/marketing/custom-mail negatives, and must be frozen before any parser/evidence rule is changed from its first result.
