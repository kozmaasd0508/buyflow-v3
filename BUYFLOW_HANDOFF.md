# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-08-23 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Active development base:** `codex/mailgun-inbound-shadow-v3`  
**TechnicalEvidence work:** PR #256 / `codex/technical-evidence-shadow-v1`

## CURRENT TECHNICALEVIDENCE STATE — 2026-08-23

PR #256 adds a separate `TechnicalEvidence v1` observational lane. It does **not** change the frozen Extraction Engine v2, Purchase Identity Graph v2, production deterministic parser, database schema or production writes.

Current v1 extractor families:
- semantic/authentication headers;
- semantic URL query/path identifiers;
- HTML title/class/id/data/alternate-text evidence;
- JSON-LD/schema.org evidence.

Safety invariants:
- shadow only;
- 0 production writes;
- 0 AI calls;
- raw TechnicalEvidence must not be persisted/logged; use privacy-reduced summary;
- no automatic identity/merge authority.

### First Real Gmail development measurement

A six-case RAW preflight used already-reviewed development cases covering Sportvision order, GymBeam sent/invoice and Express One processing/out-for-delivery/delivered.

Current TechnicalEvidence v1 preflight:
- auth/transport evidence: **6/6**;
- commerce-specific technical evidence: **3/6**;
- hard identifier evidence: **1/6**;
- explicit event evidence: **2/6**;
- explicit tracking evidence: **1/6**;
- structured JSON-LD in this slice: **0/6**.

Key positive signals:
- Sportvision HTML title -> `order_created` evidence;
- Express One delivered tracking URL `trackingNr` -> hard tracking evidence;
- GymBeam invoice HTML title -> invoice event evidence.

Key gaps exposed before any cutover:
- `X-Mailin-Tag: order-sent` is not yet mapped to shipment;
- `X-Mailin-Tag: order-invoice` composite tag is not yet mapped directly;
- alternate English body semantics (`shipment ID`, `air waybill`, `has been delivered`, delivery-day wording) are not yet parsed;
- host-qualified URL aliases need a safe design.

A new privacy-safe side-by-side evaluator exists at `technical-evidence-real-gmail-measurement-v1.ts`; it can compare exact TechnicalEvidence support and potential rescue of baseline Extraction v2 misses on private Real Gmail GT cases without returning raw values.

**Conclusion:** architecture is promising, but v1 is not broad enough to claim recall improvement. Keep it shadow-only. Safest next step is TechnicalEvidence v1.1 generic machine-semantic expansion, then rerun development GT before any fresh blind claim.

Detailed protocol: `protocols/TECHNICAL-EVIDENCE-REAL-GMAIL-MEASUREMENT-V1-2026-08-23.md`.

## PURCHASE IDENTITY / REAL GMAIL STATE

Purchase Identity Graph v2 and the Real Gmail Ground Truth v1 harness already exist on the active development base. The graph remains namespace-safe and zero-write in shadow. Real Gmail GT uses opaque SHA-256 case IDs and forbids raw private email content in the public repository.

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. Hard identifiers require compatible namespaces for automatic linking.
5. Hard conflict blocks automatic correlation.
6. Generic/domain/time similarity is never sufficient for unsafe merge.
7. New evidence layers remain shadow until independently measured.
8. AI remains disabled in current production recognition.
9. No raw customer email bodies, private IDs or secrets in repository docs.

## NEXT ACTION

Implement **TechnicalEvidence v1.1** as another shadow-only step, focused on generic machine semantics rather than merchant patches:

1. normalize composite provider/template event tags (`order-confirm`, `order-sent`, `order-invoice` and equivalent forms);
2. extract labelled English machine identities (`shipment ID`, `air waybill`, `parcel number`, `order number`, `invoice number`);
3. extract stable alternate-language lifecycle phrases (processing/inbound, out for delivery, delivered, invoice/order confirmation) with exact provenance;
4. add provider/host-qualified URL aliases only when generic aliases would be unsafe;
5. rerun the same development GT measurement and compare rescue count against frozen Extraction Engine v2;
6. only after that consider a fresh untouched blind set.
