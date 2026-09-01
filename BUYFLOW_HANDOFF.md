# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-01 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Modern email source:** PR #295 (draft)  
**Mobile cleanup:** PR #297 (draft)  
**V11 Fresh Blind:** PR #299  
**V11 representation diagnostics:** PR #300 / PR #301  
**V12 robustness foundation:** `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

## SAFETY CONTRACT

- Qwen may classify commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Frozen evaluation rows remain non-trainable.
- Direct Gmail/source archive/Mailgun source persistence stay OFF by default.
- No raw customer email content or secrets in Git.

## CURRENT V11 EVIDENCE

Completed local Qwen3-8B V11 QLoRA: 5760 TRAIN / 576 validation, 18 labels, multilingual, 1440/1440 optimizer steps, best in-family validation loss about `0.000015`. Protected holdouts were not trained/read.

Fresh Blind v1 first score (frozen SHA `6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`): exact `163/180`, invalid `7`, unsafe `1`, critical-boundary errors `10`, gate `FAIL`.

Untouched Input View Holdout v2 (frozen SHA `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`):
- FULL normalized: `170/180`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

FULL means production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64. Add-back/causality diagnostics showed prompt-shape/token-position sensitivity, so do not add random technical fields based on one row.

## V12 STAGE 0 — CONSTRAINED OUTPUT PASSED DEVELOPMENT GATE

The existing V11 adapter was rerun with a decoder that permits only the 18 legal canonical outputs.

Invalid-only probe:
- 6 previously-invalid rows
- exact `6/6`
- invalid `0`
- unsafe `0`

Full 180 confirmation on the same frozen Input View Holdout v2:
- exact `176/180`
- constrained invalid output `0`
- unsafe promotions `1`
- `changed_from_valid_baseline = 0`
- no training, no adapter mutation, no fixture mutation

The constrained decoder recovered all six formerly-invalid ORDER_PROCESSING rows and did not change any previously-valid baseline prediction. Four semantic errors remain:
- ORDER_PROCESSING -> ORDER_PACKING
- REFUNDED -> RETURN
- PAYMENT -> INVOICE
- OUT_FOR_DELIVERY -> DELIVERED (unsafe)

Local reports:
- `local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/v12-output-constraint-invalid-v1.json`
- `local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/v12-output-constraint-all-v1.json`

Treat constrained semantic decoding as the V12 development output baseline. This frozen 180 remains evaluation-only and non-trainable. A new untouched post-V12 holdout is still required before production adoption claims.

## V12 STAGE 1 — STUDENT HARD-CASE MINING READY

Protocol: `protocols/V12-STAGE1-STUDENT-MINE-V1-2026-09-01.md`

Prepared a new 144-case synthetic/deidentified pilot around six hard boundary families:
- ORDER_PROCESSING vs ORDER_PACKING
- SHIPMENT_CREATED vs SHIPPED
- SHIPPED vs IN_TRANSIT
- OUT_FOR_DELIVERY vs DELIVERED
- RETURN vs REFUNDED
- PAYMENT vs INVOICE

Coverage: hu/en/de/pl/fr/es, both sides of every boundary, two representation variants per label/language. No Fresh Blind/Input View Holdout row is copied.

The unchanged V11 student + constrained decoder classifies all 144 first. Only student disagreements plus a small agreement-audit sample are written to a local teacher-review queue. This reduces future strong-teacher calls and preserves provenance.

Files:
- `scripts/v12_hard_candidates_v1.py`
- `scripts/v12-student-mine-candidates-v1.py`
- `scripts/run-v12-student-mine-v1.ps1`
- `scripts/BuyFlow-V12-STUDENT-MINE.cmd`

No external teacher API is called yet. No training occurs in Stage 1 mining.

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate test worktree.
2. Run `scripts/BuyFlow-V12-STUDENT-MINE.cmd`.
3. Preserve the first `# SUMMARY`, candidate hash, family disagreement counts and local teacher-review queue.
4. Then connect a strong teacher only to the disagreement queue + agreement audit sample, with synthetic/deidentified inputs and explicit provenance.
5. After teacher approval, generate representation-invariance siblings and only then build V12 TRAIN/validation splits.
6. Never train on Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50.
7. Qwen remains semantic-only; Zero-Trust Purchase Identity Graph remains authoritative.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
