# BuyFlow Protocol Production Readiness Matrix

Status date: **2026-08-17**

This document is a release-safety view of the protocol library. It does **not** promote any profile to production and does not authorize writes. The production registry remains intentionally empty until a separate promotion change is reviewed.

## Readiness labels

- **GREEN** — strong candidate for the next *production-shadow* phase. Rules are based on direct recipient evidence, have hard-negative coverage, and the live mailbox audit shows no unresolved dangerous semantic behavior. GREEN does **not** mean direct production writes are allowed.
- **YELLOW** — keep in shadow. The profile is useful and may have strong direct evidence, but at least one production gate is still open: insufficient live volume, unresolved cross-parser differences, sender/template variability, provider/header limitation, transitional identity, or narrow sample count.
- **RED** — research/hard-negative only for positive lifecycle automation. Positive production lifecycle behavior must not be enabled from the current profile.

A profile can be RED for positive lifecycle recognition while still being valuable as a hard-negative classifier.

## Promotion gates

A profile may move from GREEN candidate to an actual production registry entry only in a separate change that proves all of the following:

1. Direct recipient-email provenance for every automatic positive event.
2. Authentication identity is verified where available: exact sender plus DKIM and/or Return-Path/transport evidence as appropriate.
3. Positive fixtures and adversarial hard-negative fixtures exist.
4. Identifier extraction cannot silently cross-link unrelated purchases.
5. Direct carrier/payment/invoice authority precedence is preserved.
6. No subject-only lifecycle promotion for high-risk states.
7. `SHIPMENT_CREATED != SHIPPED`, `READY_FOR_PICKUP != DELIVERED`, return request != `RETURN`, refund wording != settled `REFUNDED`.
8. Real-mailbox shadow audit has no unresolved dangerous conflict for the events being promoted.
9. First rollout is **production-shadow only**: log evidence, perform no Purchase/document/status writes from protocol evidence.
10. Write enablement, if ever approved, is a later independent gate with ambiguity/review fallbacks still active.

## Real mailbox audit baseline

The 2026-08-17 read-only cross-parser audit covered **9,432** messages over the configured two-year window.

- 31 test profiles existed at audit time.
- 28 profiles had explicit sender identities usable by the optimized sender prefilter.
- 3 generic commerce profiles were excluded from the sender-only comparison lane.
- 1,248 messages passed the explicit-sender candidate gate and required full fetch; 8,184 were rejected before full fetch.
- 634 messages matched at least one shadow profile.
- 535 carried a positive lifecycle event and 99 were `OTHER` hard-negative/safety matches.
- The existing deterministic parser was also positive on 271 messages.
- 239 messages were positive in both systems.
- Among those 239 overlaps, 44 were exact and 139 semantically compatible.
- 56 were flagged for manual semantic review. The comparator is **not ground truth**; a conflict can mean the new protocol is more conservative than legacy behavior.

The conflict concentration was highly localized:

- GLS: 46
- Alza: 7
- Express One: 2
- MPL: 1

Manual review confirmed the dominant pattern is the physical-handoff boundary: pre-advice / parcel-created wording must remain `SHIPMENT_CREATED` when the message still describes future carrier possession. That is intentionally safer than promoting it to physical shipment progress.

## Executive rollout summary

| Readiness | Count | Meaning |
|---|---:|---|
| GREEN | 5 | Candidate for production-shadow instrumentation only |
| YELLOW | 22 | Continue shadow / gather or resolve specific evidence |
| RED | 6 | Research or negative-only for positive lifecycle automation |
| **Total** | **33** | 31 test + 2 research-only profiles |

Recommended first production-shadow wave:

1. `carrier.hu.dpd`
2. `carrier.hu.foxpost`
3. `carrier.hu.expressone`
4. `merchant.hu.gymbeam`
5. `payment.hu.simplepay`

These should still emit observations only. No automatic production write is implied by this ranking.

---

## Commerce/platform profiles

| Profile | Readiness | Current safe scope | Evidence / risk | Production gate |
|---|---|---|---|---|
| `commerce.woocommerce` | YELLOW | Narrow observed lifecycle templates; conservative refund/payment/fulfillment boundaries | Platform templates vary by merchant, plugin and customization; sender identity is not globally uniform | Add more directly observed merchant-owned WooCommerce generations and mailbox replay before production-shadow |
| `commerce.shopify` | RED | Shared Shopify sender may classify as `OTHER` only | Shared sender does not safely identify the merchant; positive lifecycle would risk cross-merchant identity | Require independent merchant identity plus verified recipient templates before any positive event |
| `commerce.unas` | YELLOW | `ORDER_CREATED` from observed UNAS transport + rendered order structure | Strong structural idea but narrow positive scope and transport assumptions need broader real-mail coverage | Replay more unrelated UNAS shops and verify no false order creation on non-order system mail |
| `commerce.shoprenter` | YELLOW | `ORDER_CREATED` only; merchant-defined status labels intentionally not globalized | Shoprenter merchants customize statuses and wording; global status dictionary is unsafe | Expand cross-merchant creation fixtures and keep all merchant status semantics merchant-specific |

## Merchant profiles

| Profile | Readiness | Live-audit signal | Current safe scope / reason | Production gate |
|---|---|---:|---|---|
| `merchant.hu.gyerekjatekbolt` | YELLOW | 3 matches: 2 exact, 1 compatible, 0 conflict | Direct observed payment success, handoff and merchant delivery wording; infrastructure-bound | Small live sample; collect more orders and hard negatives before production-shadow |
| `merchant.hu.homeautomatica` | YELLOW | 4 shadow-only, 0 conflict | Direct observed order/payment/pre-handoff semantics; dangerous labels such as `Jóváírás` and `Elküldve` are blocked | Need independent live comparator/ground-truth sample and more orders |
| `merchant.hu.webarena` | YELLOW | 1 shadow-only, 0 conflict | `ORDER_CREATED`; `Elküldve` and `Teljesítve` deliberately remain `OTHER` | Too little live volume for promotion |
| `merchant.hu.forproshop` | YELLOW | 1 exact, 0 conflict | `ORDER_CREATED`; ambiguous merchant shipping-progress labels remain non-physical | Too little live volume for promotion |
| `merchant.hu.emag` | RED | Safety/hard-negative oriented | Authenticated abandoned-cart and marketing examples prove why rich product/price/refund wording must not create lifecycle | No verified direct recipient order lifecycle template yet |
| `merchant.hu.gymbeam` | **GREEN** | **16 exact / 16; 0 conflict** | Direct legacy + current auth generations; order creation, processing, pre-handoff, delay, merchant payment proof and invoice are explicitly separated | Eligible for production-shadow only; preserve carrier/payment provider precedence and do not add unsupported final states |
| `merchant.hu.notino` | RED | Hard-negative oriented | Verified unfinished cart / account / newsletter separation; no invented positive lifecycle | Need a direct real transaction lifecycle before positive production work |
| `merchant.hu.pcx` | YELLOW | 2 shadow-only, 0 conflict | Direct order, packing, physical DPD handoff and invoice attachment boundaries are strong | Live sample count is still too small |
| `merchant.hu.alza` | YELLOW | 23 total: 14 exact, 2 shadow-only, 7 conflicts | Rich direct lifecycle: received order, processing, payment action, cancellation, physical DPD handoff, delay, pickup, return/refund boundaries | Resolve/document all 7 overlap conflicts by event; keep initial receipt semantically distinct from contract acceptance |
| `merchant.hu.ipon` | YELLOW | 18 shadow-only, 0 conflict | Direct order, processing/pre-advice/invoice plus strong cart/review/human-reply negatives | Needs independent replay/ground-truth set because legacy parser is mostly silent |
| `merchant.hu.euronics` | YELLOW | 2 shadow-only, 0 conflict | Direct order creation and cancellation semantics with account/marketing hard negatives | More live lifecycle volume required |
| `merchant.hu.bestbyte` | YELLOW | 1 shadow-only, 0 conflict | Strong direct invoice authority only; marketplace/carrier wrappers excluded | Too narrow and too little live volume for merchant-wide production use |
| `merchant.hu.mediamarkt` (`research`) | RED | Not test-registry production candidate | Official docs establish boundaries, but no direct recipient transaction sender/DKIM/template was found | Obtain real recipient emails; replace inferred patterns with observed templates |
| `merchant.hu.aqua` (`research`) | RED | Not test-registry production candidate | Official docs only; no direct transaction mail in mailbox; operator changed in 2025 | Obtain current post-operator-change recipient emails and authentication fingerprints |

## Carrier profiles

| Profile | Readiness | Live-audit signal | Current safe scope / reason | Production gate |
|---|---|---:|---|---|
| `carrier.hu.foxpost` | **GREEN** | 84 total; 34 compatible, 50 shadow-only, **0 conflict** | Direct pre-advice, warehouse possession and locker/pickup-ready states with tracking identity | Production-shadow candidate; continue to reject generic delivered inference |
| `carrier.hu.gls` | YELLOW | 109 total; 57 compatible, 6 shadow-only, **46 conflicts** | Current shadow correctly keeps parcel-information/pre-advice at `SHIPMENT_CREATED`; OFD and locker-ready are distinct | Convert the 46 legacy differences into a documented reviewed conflict set before production-shadow |
| `carrier.hu.mpl` | YELLOW | 142 total; 2 exact, 139 shadow-only, 1 conflict | Broad direct lifecycle including pre-advice, OFD, failed attempt, pickup-ready and explicit delivery proof | Manually close the remaining conflict and verify legacy/current template generations as one reviewed set |
| `carrier.hu.expressone` | **GREEN** | 15 total; 9 exact, 4 shadow-only, 2 conflicts | Direct full chain clearly separates pre-advice, physical hub possession, OFD, delay and delivered timestamp | The 2 differences are pre-advice/physical-progress boundary reviews; keep that conservative boundary frozen in production-shadow |
| `carrier.hu.dpd` | **GREEN** | 71 total; 47 compatible, 24 shadow-only, **0 conflict** | Direct pre-advice, physical dispatch, OFD, delivery and refusal-return boundaries are explicit | Production-shadow candidate; keep payment receipt and myDPD/account messages hard-negative |
| `carrier.hu.packeta` | YELLOW | 21 shadow-only, 0 conflict | Direct handoff and pickup-ready evidence exists | 2026 FoxPost legal-successor transition makes channel identity transitional; collect more current-generation live mail |

## Payment profiles

| Profile | Readiness | Live-audit signal | Current safe scope / reason | Production gate |
|---|---|---:|---|---|
| `payment.hu.simplepay` | **GREEN** | 23 shadow-only, 0 conflict | Direct authenticated explicit payment-success events; external merchant reference is not promoted to global order identity | Production-shadow candidate; require existing resolver/linking safety before any write |
| `payment.hu.barion` | YELLOW | Direct real samples reviewed; success + refund-boilerplate hard negative | Authenticated success receipts are strong and refund help text is correctly ignored | Run a larger explicit-sender mailbox replay and quantify multiple sender generations before GREEN |
| `payment.stripe` | YELLOW | No strong live-audit volume in current mailbox window | Direct receipt semantics are strong, but dynamic receipt sender forms/custom domains broaden operational variability | Collect current real receipt volume across supported sender forms; custom merchant domains remain out of scope |
| `payment.paypal` | RED | Hard-negative/research only | Monthly statement and legal/account mail are safely `OTHER`; transaction/refund words in statements are not lifecycle | Need verified direct buyer transaction templates before positive payment automation |

## Invoicing profiles

| Profile | Readiness | Current safe scope / reason | Production gate |
|---|---|---|---|
| `invoicing.hu.billingo` | YELLOW | Direct authenticated invoice email; invoice existence never implies payment success | Run larger live-volume replay and verify invoice generations/document-link variants |
| `invoicing.hu.billingo.proforma` | YELLOW | Valuable negative-only rule: díjbekérő/proforma remains `OTHER` even with invoice-like labels | Keep negative-only until more provider template variants are observed |
| `invoicing.hu.szamlazz` | YELLOW | Direct provider invoice authority, dynamic merchant-specific sender supported | Raw custom header support is still limited; templates are merchant-customizable, so replay more variants |
| `invoicing.hu.szamlazz.storno` | YELLOW | Negative-only: storno is not settled `REFUNDED` | Expand direct storno sample set and identifier behavior before production-shadow |
| `invoicing.hu.szamlazz.payment-reminder` | YELLOW | Negative-only: reminder is not `PAYMENT_FAILED` or `PAYMENT_ACTION_REQUIRED` | Expand provider/merchant-customized reminder variants before production-shadow |

## Global blockers before any production write

These are library-wide, not profile-specific:

1. **Production registry is still empty by design.** Keep it empty during the next production-shadow instrumentation step.
2. Protocol evidence must continue through the existing deterministic classifier, entity resolution and controlled write gates.
3. Live ingestion must provide the authentication fields required by promoted profiles consistently. Missing DKIM/Return-Path evidence must fail closed for rules that require it.
4. Arbitrary raw-header fields such as Számlázz.hu-specific headers are not yet a general `ProtocolDetectionInput` field; do not pretend otherwise.
5. Generic platform profiles must not force every mailbox message into full fetch. Explicit-sender prefiltering and a separate generic discovery lane should remain distinct.
6. `OTHER` hard-negative profiles must not accidentally become purchase anchors.
7. Promotion should be event-scoped. A GREEN carrier profile does not imply every possible carrier event is supported.
8. No runtime AI is required or assumed by this readiness plan.

## Next actions

### Gate A — close YELLOW conflicts

- GLS: review/tag all 46 legacy overlap differences by semantic boundary.
- Alza: review/tag all 7 overlap differences, especially initial order receipt vs acceptance and payment-action semantics.
- MPL: close the single conflict.
- Express One: retain the conservative pre-advice boundary and document the two differences as reviewed/non-dangerous.

### Gate B — production-shadow instrumentation

After Gate A, add a separate, explicitly reviewed **read-only production-shadow** path for GREEN profiles only. It may record counters/diagnostics, but must not mutate Purchase, shipment, payment, invoice, return, refund or warranty state.

### Gate C — recall expansion

After readiness work, prioritize real mailbox gaps by frequency rather than adding random merchants. Current high-value gap identified during manual review: **SportVision**, followed by families such as FNP Products, Marketa, Digitmaster, Book24 and Dronozok.

### Gate D — only later consider write promotion

No profile should enter write-capable production behavior merely because it is GREEN here. Write promotion requires a separate PR, event-by-event decision, fresh mailbox audit and an explicit rollback/fail-closed plan.
