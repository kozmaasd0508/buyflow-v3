# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`. Code/live state outranks this handoff if anything conflicts.

**Last updated:** 2026-08-23 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**GitHub main HEAD observed:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Active development base:** `codex/mailgun-inbound-shadow-v3` @ `c2f0e8c7223e1fa0b20d087864a3b6f9ff28624f`  
**Active PR:** #256 — TechnicalEvidence v1 multi-layer shadow collector  
**Production deploy:** not re-verified by the #256 change; do not infer live deployment from Git state.

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when GitHub/Supabase can recover it. Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## CURRENT PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return/refund emails into one safe lifecycle view.

Core safety direction:
- deterministic-first production recognition;
- precision > recall;
- ambiguity/conflict => REVIEW or PENDING, never unsafe merge;
- lifecycle-only mail cannot create a Purchase;
- hard identity is namespace-scoped;
- AI is disabled in current production recognition work;
- raw message-derived evidence must remain auditable and privacy-safe.

Relevant layers now exist separately:
1. normalized email / `EmailDocumentV1`;
2. frozen **Extraction Engine v2** shadow candidate;
3. direct Extraction v2 -> canonical event adapter;
4. **Purchase Identity Graph v2** zero-write shadow orchestration;
5. privacy-safe Real Gmail Ground Truth v1 harness;
6. new **TechnicalEvidence v1** observational lane in PR #256.

## EXTRACTION ENGINE v2 — FROZEN SHADOW CANDIDATE

`runExtractionEngineV2()` remains shadow-only:
- `mode = shadow`;
- `productionWrites = 0`;
- `aiCalls = 0`;
- no legacy parser output is used as truth;
- field provenance is preserved;
- conflicts and cross-field contradictions can require REVIEW.

Do not tune the frozen Extraction Engine v2 directly against already-reviewed Ground Truth cases. New extraction ideas should first be measured in a separate observational lane.

## PURCHASE IDENTITY GRAPH v2 — CURRENT DEVELOPMENT STATE

Recent development PRs on `codex/mailgun-inbound-shadow-v3` established the identity foundation:
- #245 — namespace-scoped identity contracts and collision safety;
- #246 — namespace-qualified hard evidence + Hard Conflict Gate;
- #247 — direct Extraction Engine v2 -> CanonicalEvent adapter;
- #248 — end-to-end zero-write shadow orchestration;
- #249 — deterministic Merchant Identity Registry foundation;
- #251/#252 — time-safe merchant identity signals and explicit sender-domain authority;
- #253/#254 — real `@buyflow.hu` shopping mail runs through Identity Graph v2 in shadow using user-scoped legacy snapshots;
- #255 — privacy-safe Real Gmail Ground Truth v1 harness.

Important identity rules:
- order number is hard only inside a compatible merchant namespace;
- tracking number is hard only inside a carrier namespace;
- invoice number is hard only inside an issuer namespace;
- payment reference is hard only inside a payment-provider namespace;
- unscoped identifiers may discover candidates but must not become unsafe hard links;
- unresolved hard conflicts block automatic correlation;
- REVIEW/PENDING must not mutate graph state.

## REAL GMAIL GROUND TRUTH v1

PR #255 added a privacy-safe evaluator for real Gmail cases:
- opaque SHA-256 case IDs;
- raw subject/body/sender/message IDs do not enter reports;
- independent ground truth is separate from engine output;
- current reviewed Gmail cases are **development ground truth**, not a fresh blind holdout;
- fresh accuracy claims require unseen cases frozen before tuning.

Known real-life motivation for the identity work includes the GymBeam -> Express One lifecycle where an order/shipment email and later carrier delivery mail share the same tracking identity, but legacy projection/correlation failed to create/link the Shipment correctly.

## TECHNICAL EVIDENCE v1 — PR #256

PR #256 is intentionally a **separate observational lane**. It does not feed Extraction Engine v2 or Identity Graph v2 yet.

Added contract:
- field kind;
- raw + normalized value;
- optional namespace;
- exact technical source;
- exact `sourcePath`;
- extractor id/version;
- confidence + qualifiers.

First four extractor families:
1. **Header evidence**
   - semantic order/tracking/invoice/payment-reference headers;
   - template/event tags;
   - authentication headers preserved as a separate source.
2. **URL evidence**
   - semantic query parameters;
   - semantic URL path segments;
   - malformed URLs/percent encoding fail closed/non-fatally.
3. **HTML semantic evidence**
   - `<title>` lifecycle cues;
   - class/id platform fingerprints;
   - `data-*` / `itemprop` identifiers;
   - alt/title/aria-label carrier evidence.
4. **Structured data evidence**
   - JSON-LD/schema.org event types;
   - order/tracking/invoice/payment identifiers;
   - amount/currency/payment method/carrier/date;
   - nested merchant/product evidence.

Safety invariants in #256:
- no production parser modification;
- frozen Extraction Engine v2 untouched;
- Purchase Identity Graph v2 untouched;
- no DB migration;
- no runtime wiring;
- `productionWrites = 0`;
- `aiCalls = 0`;
- collector does not mutate `EmailDocumentV1`;
- malformed JSON-LD does not fail the collector;
- raw TechnicalEvidence must not be persisted/logged; privacy-reduced diagnostics use only the summary API.

Validation so far for #256:
- isolated strict TypeScript (`strict + noUncheckedIndexedAccess`) compile PASS;
- isolated runtime smoke PASS;
- PR is mergeable;
- full repository CI has **not** run because `.github/workflows/ci.yml` triggers only for `main` pushes/PRs.

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. Hard identifiers require their correct namespace.
5. Hard conflicts block automatic correlation until explicitly resolved.
6. Public/shared/provider/relay sender identity cannot establish merchant identity alone.
7. Storefront domain is not automatically email sender authority.
8. `SHIPMENT_CREATED` / label / pre-advice does not prove physical shipment.
9. Future/conditional fulfillment wording does not prove current fulfillment state.
10. `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `DELIVERED` remain distinct.
11. Payment-only email must never create a Purchase.
12. Raw private Gmail content must never be committed to the public repository.
13. Do not claim accuracy from differential agreement; only independent frozen ground truth can support accuracy claims.
14. Do not connect TechnicalEvidence directly to automatic merge/write decisions before side-by-side measurement and explicit safety gates.

## NEXT ACTION

1. Review PR #256 scope and keep it observational-only.
2. Add a **privacy-safe side-by-side TechnicalEvidence audit** to Real Gmail Ground Truth v1:
   - current Extraction v2 field coverage;
   - TechnicalEvidence layer coverage;
   - source-layer contribution counts;
   - whether missing legacy/v2 fields are recoverable from deeper evidence;
   - no raw message content in output.
3. Use development GT only for diagnosis, not a fresh accuracy claim.
4. Do **not** feed TechnicalEvidence into Identity Graph v2 yet.
5. Only after measurement, design deterministic evidence promotion rules and namespace validators.
6. PDF/QR/raw-MIME expansion comes after the first header/URL/HTML/JSON-LD measurement proves value.

## QUALITY TARGET

- false automatic Purchase = 0;
- wrong automatic link = 0;
- duplicate Purchase/Shipment/Document = 0;
- REVIEW/PENDING preferred over unsafe automation;
- true purchase recognition should improve through stronger evidence, not merchant-specific one-off patches;
- target principle: **tolerant recognition, strict identity, nothing silently discarded**.
