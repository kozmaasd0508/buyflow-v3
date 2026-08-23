# BuyFlow worklog latest

Current TechnicalEvidence branch: `codex/technical-evidence-shadow-v1`

PR: #256 -> `codex/mailgun-inbound-shadow-v3`

Mode: shadow/read-only, 0 production writes, 0 AI calls, no runtime/DB/Identity Graph authority.

## TechnicalEvidence progression — 2026-08-23

- v1 foundation: headers/auth, URL semantics, HTML semantics, structured data, provenance-preserving evidence.
- Same 6 reviewed Gmail development cases: v1 -> v1.1 commerce-specific coverage **3/6 -> 6/6**, explicit event **2/6 -> 6/6**, hard identifier **1/6 -> 3/6**.
- Broader 10-family slice (WooCommerce, UNAS, Shopify, GLS, MPL, FOXPOST, DPD, Billingo, Számlázz.hu, merchant invoice/PDF): v1.2 reached commerce-specific **6/10**, explicit event **3/10**, hard identifier **4/10**.
- v1.4 adds strict PDF invoice evidence, authenticated DPD lifecycle/parcel semantics, and authenticated FOXPOST lifecycle/dual-id semantics.
- Same 10-family development slice now reaches commerce-specific **9/10**, explicit event **6/10**, hard identifier **7/10**.
- Additional reviewed GLS COD-receipt PDF family yields payment-completed + GLS parcel identity + GLS COD payment reference + amount/currency. On an extended 11-family development slice: commerce-specific **10/11**, explicit event **7/11**, hard identifier **8/11**.
- These are development coverage figures only, NOT blind precision/recall or production accuracy claims.

## New shadow modules

- `apps/api/src/extraction-v2/technical-evidence-pdf-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-v1.test.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.test.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-payment-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-pdf-payment-v1.test.ts`
- `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V14-2026-08-23.md`

## Safety status

- generic `code`, `ref`, `ids`, and unlabeled numbers remain non-authoritative outside typed/provider-qualified contexts;
- DPD opaque myDPD access code is not tracking identity;
- FOXPOST pre-advice may create parcel identity evidence but never physical-shipment event evidence;
- PDF filename alone is not proof;
- PDF evidence requires explicit fields plus verified document/provider context;
- Shopify platform fingerprint still grants no lifecycle authority;
- no automatic Purchase/Shipment merge authority was added;
- no production parser, Extraction Engine v2, Identity Graph v2, database schema, or runtime wiring was changed.

## Next gate

1. inspect multiple independent Shopify commerce templates before granting Shopify lifecycle authority;
2. consider QR/barcode evidence as namespaced corroboration only;
3. expand PDF evidence to additional independently reviewed invoice/payment families;
4. run full repository typecheck/tests when a CI-capable target is available;
5. freeze a fresh untouched broad holdout before any generalization/accuracy claim.
