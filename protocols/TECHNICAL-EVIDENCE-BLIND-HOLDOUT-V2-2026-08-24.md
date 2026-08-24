# TechnicalEvidence Blind Holdout v2 — executable v1.5

**Status:** CANDIDATE FREEZE ESTABLISHED BEFORE V2 DATA SELECTION  
**Mode:** EVALUATION ONLY · 0 PRODUCTION WRITE · 0 AI

## Exact code freeze

Executable TechnicalEvidence v1.5 candidate commit:

`af13bc7dbc54f24e2a730577c451198a031a6bdf`

Commit timestamp / selection cutoff:

`2026-08-23T22:17:45Z` (`2026-08-24 00:17:45 Europe/Budapest`)

Only messages whose `receivedAt` is strictly after this cutoff may enter the first future Blind Holdout v2 candidate pool.

This freeze supersedes TechnicalEvidence Blind Holdout v1 because v1.5 had previously existed as separate development modules rather than one executable composite collector. No v1 post-freeze candidate had been inspected before that integration gap was discovered.

## Executable collector under test

Entry point:

`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

The collector composes in one shadow execution:
- TechnicalEvidence v1.2 base layers;
- authenticated carrier semantic evidence;
- native Shopify transactional evidence;
- deterministic PDF invoice evidence from an already extracted local PDF text layer;
- provider-qualified GLS COD PDF payment evidence.

PDF sender namespace is inherited from the EmailDocument sender context and cannot be injected by an attachment.

## CI gate before freeze

A temporary CI-only PR ran the exact candidate head in the repository CI merge context after the GLS Unicode receipt-label correction.

Required CI steps passed:
- API typecheck;
- API tests;
- API build;
- mobile typecheck;
- mobile web build.

The CI-only PR must not be merged; it exists only as exact-code validation evidence.

## Freeze rules

1. No TechnicalEvidence extractor, provider/carrier/PDF/Shopify semantic, normalization, namespace or authority rule may change before the first v2 prediction result.
2. Candidate selection is mailbox-first and prediction-blind.
3. Ground truth is annotated from original messages before TechnicalEvidence output is viewed for frozen cases.
4. Parser/TechnicalEvidence output never becomes ground truth.
5. The first result is permanent baseline evidence; afterward those cases are regression-only.
6. Any evaluation-affecting code change versions the unseen set forward; the same cases may not be called blind again.

## Candidate target

Use only genuinely unseen post-cutoff traffic. Do not backfill with already inspected development or retro messages.

Where naturally available include:
- order confirmation / order created;
- payment confirmation / receipt;
- invoice / PDF-backed invoice;
- shipment creation / physical handoff;
- out for delivery / ready for pickup;
- delivered;
- return / refund / cancellation;
- hard non-commerce noise;
- provider account/security/marketing mail;
- platform-looking custom mail;
- generic `id` / `ids` / `code` / `ref` traps;
- QR/action-code cases.

## Critical safety failures

Any is critical:
- untyped generic id/ref/code promoted to hard identity;
- platform fingerprint alone promoted to commerce lifecycle authority;
- future/conditional shipment promoted to current shipment;
- pre-advice promoted to physical shipment;
- ready-for-pickup promoted to delivered;
- QR/pickup code promoted to tracking without explicit proof;
- carrier namespace invented without carrier proof;
- contradictory hard identifiers merged rather than REVIEW/unsupported;
- payment-only evidence creating Purchase authority.

## Relationship to retro-200

The 200 historical Gmail messages selected in `TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-2026-08-24.md` remain valuable as a retro-generalization/regression dataset, but their content was inspected before the executable v1.5 composition was completed. They are therefore NOT blind evidence for this v2 collector.

## Production boundary

This freeze does not activate TechnicalEvidence in production. TechnicalEvidence remains observational only: 0 writes, 0 AI, no DB mutation, no Purchase creation/linking and no Purchase Identity Graph authority.
