# TechnicalEvidence Blind Holdout v5 — after REGIO R1

**Status:** FROZEN BEFORE V5 DATA SELECTION  
**Mode:** EVALUATION ONLY · 0 PRODUCTION WRITE · 0 AI

## Exact code/test freeze

TechnicalEvidence v1.5 + Direction Gate v1 + Packeta R1 + MPL R1 + REGIO R1 validated snapshot:

`e13ef747f8f622cf88d5c9f647c324a197569522`

Commit timestamp / selection cutoff:

`2026-08-24T18:23:26Z` (`2026-08-24 20:23:26 Europe/Budapest`)

Only messages whose received timestamp is strictly after this cutoff may enter the first future Blind Holdout v5 candidate pool.

Blind Holdout v5 supersedes v4 because REGIO R1 changed evidence/authority behavior after the v4 freeze. No v4 post-cutoff candidate content was inspected before this version increment. Only historical 2025 REGIO development/retro messages were reviewed.

## First post-cutoff preflight

A Gmail **ID-only** query strictly after the cutoff returned:

**0 messages**

No post-cutoff message body, subject, attachment or prediction was inspected. Blind Holdout v5 therefore remains untouched.

## Current executable stack under test

- TechnicalEvidence v1.2 base layers
- Direction Gate v1
- DPD / FOXPOST / Packeta / MPL carrier semantics
- native Shopify semantics
- REGIO/SiteEngine R1 merchant semantics
- deterministic PDF invoice evidence
- provider-qualified GLS COD PDF evidence

## REGIO R1 safety boundary

REGIO lifecycle authority requires all of:
- exact direct `regiojatek.hu` sender domain;
- matching DKIM pass;
- SiteEngine(c)GreyMatter multipart boundary;
- one unique explicit `WS .../...` order identity;
- order identity agreement between current subject and body;
- one reviewed current lifecycle template.

Supported R1 lifecycle:
- order received/recorded;
- fulfillment processing started;
- explicit handoff to carrier.

A survey/review message from the same authenticated sender/platform with the same order number remains non-actionable without a current lifecycle template.

## CI gate before freeze

GitHub Actions CI run #960 validated exact snapshot `e13ef747f8f622cf88d5c9f647c324a197569522`:
- API typecheck PASS
- API tests **1114/1114 PASS**
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

CI-only PR #262 was closed without merge.

## Freeze rules

1. No evidence-producing, normalization, namespace, provider-semantic or authority rule changes before first v5 prediction result.
2. Candidate selection is mailbox-first and prediction-blind.
3. Human ground truth must be frozen from original source messages before predictions are viewed.
4. Parser/TechnicalEvidence output never becomes ground truth.
5. First prediction result is permanent baseline evidence; afterward those cases are regression-only.
6. Any evaluation-affecting code change versions the unseen set forward.
7. Historical development/retro messages inspected before this cutoff are excluded from v5 blind evidence.

## Critical failures

Any is critical:
- generic id/ref/code promoted to hard identity without typed provider context;
- platform fingerprint alone promoted to lifecycle authority;
- future/conditional shipment promoted to current physical shipment;
- ready-for-pickup promoted to delivered;
- survey/review mail promoted solely from sender/platform/order history;
- carrier namespace invented without proof;
- conflicting hard identifiers merged rather than REVIEW/unsupported;
- payment-only evidence creating Purchase authority;
- seller-outbound or return-to-seller evidence influencing buyer Purchase authority.

## Historical regression reference only

After REGIO R1 on the frozen retro-200:
- Event: TP 14 / FP 0 / FN 19 / TN 167
- Actionable: TP 17 / FP 0 / FN 16 / TN 167

These figures are NOT blind accuracy.

## Production boundary

This freeze does not activate TechnicalEvidence in production. It remains shadow/read-only:
- 0 production writes
- 0 AI calls
- no Purchase/Shipment creation
- no automatic linking
- no Purchase Identity Graph decision authority
