# TechnicalEvidence Blind Holdout v3 — executable v1.5 + Direction Gate v1 + Packeta R1

**Status:** CANDIDATE FREEZE ESTABLISHED BEFORE V3 DATA SELECTION  
**Mode:** EVALUATION ONLY · 0 PRODUCTION WRITE · 0 AI

## Why v3 exists

TechnicalEvidence Blind Holdout v2 froze the executable v1.5 collector before the Source Role / Direction Gate and the Packeta recall adapter were finalized.

The retro-200 characterization later exposed two separate facts:

1. source role/direction must gate buyer-Purchase authority to prevent seller-side carrier mail from becoming purchase lifecycle evidence;
2. native Packeta buyer shipment mail was a real false-negative family and could be supported with narrow provider-qualified technical evidence.

The Packeta development work used already-inspected historical/pre-cutoff messages. No post-v2 unseen candidate content was used to tune the adapter. Therefore v2 remains a historical freeze record and v3 becomes the active future blind protocol.

## Exact evidence candidate freeze

Candidate snapshot commit:

`ca3ae62b358f7b7cdcde63a6e1c0960c54b49513`

Commit timestamp / selection cutoff:

`2026-08-23T23:28:16Z` (`2026-08-24 01:28:16 Europe/Budapest`)

Only messages whose `receivedAt` is strictly after this cutoff may enter the first TechnicalEvidence Blind Holdout v3 candidate pool.

Later CI-workflow-only or documentation-only commits do not alter the evidence freeze semantics. Any later change to TechnicalEvidence extraction, normalization, provider semantics, direction eligibility, namespaces or authority logic DOES invalidate this freeze and requires a new holdout version before a blind result is claimed.

## Executable path under test

Evidence collector:

`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

Purchase-authority safety gate:

`apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`

Authority path:

`collectTechnicalEvidenceV15 -> applyTechnicalEvidenceDirectionGateV1 -> downstream identity/conflict gates`

Never:

`technical cue -> Purchase lifecycle authority`

TechnicalEvidence remains shadow-only and does not create/link Purchase or Shipment records.

## Packeta R1 included in this freeze

Direct Packeta authority is deliberately narrow:

- exact sender primary domain must be `packeta.hu`;
- newsletter/marketing subdomains such as `hirek.packeta.hu` are excluded;
- Packeta tracking identity is namespaced `PACKETA`;
- a hard Z tracking identifier requires at least two independent provider/template primitives;
- every present Z primitive must normalize to the same exact identifier;
- conflicting Z identifiers produce no hard tracking identity;
- supported primitives include explicit Packeta Z-number wording, explicit `Csomagszám`, Packeta tracking-label wording and the provider tracking endpoint;
- one isolated Z-looking token or URL is insufficient;
- shipment event authority requires the exact Packeta accepted-for-transport subject plus one of the reviewed buyer-shipment semantic templates and a Packeta tracking endpoint;
- generic Packeta mentions and marketing mail never receive shipment authority from this adapter.

The historical retro sample that motivated the legacy template is regression-only and may never be counted as v3 blind evidence.

## Direction Gate v1 included in the authority evaluation

Direct-carrier TechnicalEvidence is classified as one of:

- `buyer_inbound`
- `seller_outbound`
- `return_to_seller`
- `unknown`

Strongly proven `seller_outbound` and `return_to_seller` messages retain raw audit evidence but their Purchase-authority evidence rows are blocked.

`buyer_inbound` remains eligible.

`unknown` remains eligible in Direction Gate v1; downstream hard-identity/conflict gates remain mandatory.

## Candidate selection

Selection is mailbox-first and prediction-blind.

Do NOT run TechnicalEvidence, Extraction Engine v2, legacy extraction, Purchase Identity Graph or AI to decide which candidate messages enter the set.

Use only genuinely unseen messages received strictly after the v3 cutoff.

Where the mailbox naturally provides examples, target:

- order confirmation / order created;
- payment confirmation / payment receipt;
- invoice / receipt, including PDF-backed documents;
- shipment created / physical handoff;
- in transit / out for delivery / ready for pickup;
- delivered;
- return / refund / cancellation;
- direct carrier buyer-inbound mail;
- seller-side outbound logistics;
- return-to-seller logistics;
- hard non-commerce noise;
- platform/security/account/marketing mail;
- generic `id` / `ids` / `code` / `ref` traps;
- QR/action/pickup-code cases;
- Packeta/Foxpost mixed-namespace cases where naturally observed.

Do not backfill the blind set with retro-200, development fixtures or any message already opened during TechnicalEvidence tuning.

## Ground truth

Ground truth must be annotated from the original message before TechnicalEvidence predictions are viewed for the frozen cases.

Per field use:

- `known`
- `not_applicable`
- `unknown`

Parser or TechnicalEvidence output never becomes ground truth.

Suggested dimensions:

- commerce relevance;
- lifecycle/event family;
- source role/direction;
- merchant/storefront scope;
- carrier;
- order number;
- tracking number;
- invoice number;
- payment reference;
- amount/currency;
- PDF-backed document type;
- action/pickup code when semantically separate from tracking.

## Scoring

Score both raw TechnicalEvidence and direction-gated Purchase-eligible evidence.

Per field/evidence type:

- exact supported;
- missing;
- contradiction;
- false positive;
- false negative;
- unsupported/unknown;
- source/provenance layer;
- direction eligibility.

Aggregate at minimum:

- event authority precision/recall;
- actionable TechnicalEvidence precision/recall;
- hard-identifier coverage;
- contradiction count;
- unsafe identity-authority attempts;
- false positives on hard noise;
- direction-gate blocks by reason.

## Critical safety failures

Any of the following is critical:

- generic `id` / `ids` / `code` / `ref` promoted without exact provider/type context;
- platform fingerprint alone promoted to commerce lifecycle authority;
- future/conditional shipment promoted to current shipment;
- pre-advice/label creation promoted to physical shipment;
- ready-for-pickup promoted to delivered;
- QR/pickup code promoted to tracking identity without explicit proof;
- carrier namespace invented without carrier proof;
- a single Packeta Z-looking primitive promoted to hard identity;
- conflicting Packeta Z identifiers promoted as hard identity;
- seller-outbound/return-to-seller evidence influencing buyer Purchase authority;
- contradictory hard identifiers merged rather than REVIEW/unsupported;
- payment-only evidence creating Purchase authority.

## Anti-overfitting rule

The first v3 blind result is permanent baseline evidence.

Once predictions for a frozen case are viewed, that case becomes regression-only and may not be re-scored as if it were still blind.

If any evaluation-affecting rule changes before the first result, freeze a new holdout version before inspecting new candidate content.

## Relationship to retro-200

`TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-2026-08-24.md` and its ground truth remain a historical regression/characterization dataset.

They are useful for proving non-regression and measuring targeted recall deltas, but they are not future blind evidence because message content was already inspected during development and annotation.

## Production boundary

This protocol does not activate TechnicalEvidence in production.

Required before any production authority:

1. fresh v3 blind result on unseen post-cutoff mail;
2. explicit review of every critical mismatch/false positive;
3. zero unsafe identity-authority failures;
4. repository typecheck/tests/build validation on the exact candidate logic;
5. separate explicit production activation decision.

Until then: 0 production writes, 0 AI calls, no DB mutation, no Purchase/Shipment creation or linking, and no Purchase Identity Graph authority.
