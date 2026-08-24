# TechnicalEvidence Blind Holdout v4 — after MPL R1

**Status:** FROZEN BEFORE V4 DATA SELECTION  
**Mode:** EVALUATION ONLY · 0 PRODUCTION WRITE · 0 AI

## Exact code/test freeze

TechnicalEvidence v1.5 + Direction Gate v1 + Packeta R1 + MPL R1 validated snapshot:

`58f234c63aa873794767eaaed58892a78b309298`

Commit timestamp / selection cutoff:

`2026-08-24T18:09:49Z` (`2026-08-24 20:09:49 Europe/Budapest`)

Only messages whose received timestamp is strictly after this cutoff may enter the first future Blind Holdout v4 candidate pool.

Blind Holdout v4 supersedes v3 because MPL R1 changed evidence/authority behavior after the v3 freeze. No v3 post-cutoff candidate content was inspected before this version increment.

## Executable collector under test

Entry point:

`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

Authority safety layer:

`apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`

The executable collector includes:

- TechnicalEvidence v1.2 base layers;
- authenticated DPD / FOXPOST / Packeta / MPL carrier semantics;
- native Shopify transactional evidence;
- deterministic PDF invoice evidence;
- provider-qualified GLS COD PDF payment evidence.

Direction Gate v1 keeps audit evidence while blocking strongly proven seller-outbound and return-to-seller carrier evidence from buyer-Purchase authority.

## MPL R1 additions included in this freeze

- exact direct `posta.hu` provider boundary;
- MPL hard tracking only from explicit labelled ID + same official Posta tracking URL ID;
- support for both reviewed Posta tracking endpoint forms;
- exact buyer-inbound lifecycle semantics for:
  - parcel posted to recipient;
  - parcel arrived in country;
  - courier-today / delivery attempt;
  - ready for pickup at post office;
- no automatic delivered authority from satisfaction survey/feedback mail;
- all hard IDs remain namespace-scoped `MPL`.

## CI gate before freeze

CI-only draft PR #262 / GitHub Actions run #958 validated the exact freeze snapshot in the repository main-target merge context.

Required CI steps passed:

- API typecheck;
- API tests — **1108/1108 PASS**;
- API build;
- mobile typecheck;
- mobile web build.

The CI-only PR was closed without merge.

## Freeze rules

1. No TechnicalEvidence extractor, provider/carrier/PDF/Shopify semantic, Direction Gate rule, normalization, namespace or authority rule may change before the first v4 prediction result.
2. Candidate selection is mailbox-first and prediction-blind.
3. Ground truth is annotated from original source messages before TechnicalEvidence output is viewed for frozen cases.
4. Parser/TechnicalEvidence output never becomes ground truth.
5. The first prediction result is permanent baseline evidence; afterward those cases become regression-only.
6. Any evaluation-affecting code change versions the unseen set forward; the same selected cases may not be called blind again after predictions are exposed.
7. Development/retro messages inspected before this cutoff are permanently excluded from v4 blind evidence.

## Candidate target

Use only genuinely unseen post-cutoff traffic. Do not backfill with the historical retro-200 or reviewed Packeta/MPL development messages.

Where naturally available include:

- order confirmation / order created;
- payment success/failure/action-required;
- invoice / PDF-backed invoice;
- shipment creation / physical handoff;
- in-transit / out-for-delivery / ready-for-pickup;
- delivered;
- return / refund / cancellation;
- hard non-commerce noise;
- provider account/security/marketing mail;
- direct-carrier sender-side logistics;
- platform-looking custom mail;
- generic `id` / `ids` / `code` / `ref` traps;
- QR/action-code cases.

## Critical safety failures

Any is critical:

- untyped generic id/ref/code promoted to hard identity;
- platform fingerprint alone promoted to commerce lifecycle authority;
- future/conditional shipment promoted to current physical shipment;
- pre-advice promoted to physical progress without proof;
- ready-for-pickup promoted to delivered;
- survey/feedback mail promoted to lifecycle without the frozen provider-qualified rule;
- QR/pickup code promoted to tracking without explicit proof;
- carrier namespace invented without carrier proof;
- contradictory hard identifiers merged rather than REVIEW/unsupported;
- payment-only evidence creating Purchase authority;
- seller-outbound/return-to-seller carrier evidence influencing buyer Purchase authority.

## Relationship to retro-200

The historical 200-message Retro Holdout v1 is now regression-only. The latest targeted replay after Packeta R1 + MPL R1 records:

- event authority: TP 11 / FP 0 / FN 22 / TN 167;
- actionable TechnicalEvidence: TP 14 / FP 0 / FN 19 / TN 167.

Those numbers are NOT blind accuracy and must not be used as a future-generalization claim.

## Production boundary

This freeze does not activate TechnicalEvidence in production. TechnicalEvidence remains observational only:

- 0 production writes;
- 0 AI calls;
- no DB mutation;
- no Purchase creation/linking;
- no Shipment linking;
- no Purchase Identity Graph decision authority.
