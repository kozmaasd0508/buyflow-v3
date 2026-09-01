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

Fresh Blind v1 first score: exact `163/180`, invalid `7`, unsafe `1`, critical-boundary errors `10`, gate `FAIL`.

Untouched Input View Holdout v2:
- FULL normalized: `170/180`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

FULL means production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64. Add-back/causality diagnostics showed prompt-shape/token-position sensitivity, so do not add random technical fields based on one row.

## V12 STAGE 0 — CONSTRAINED OUTPUT PASSED DEVELOPMENT GATE

The unchanged V11 adapter was rerun with a decoder that permits only the 18 legal canonical outputs.

Invalid-only probe: 6/6 exact, invalid 0, unsafe 0.

Full 180 confirmation on frozen Input View Holdout v2:
- exact `176/180`
- constrained invalid output `0`
- unsafe promotions `1`
- `changed_from_valid_baseline = 0`
- no training, adapter mutation or fixture mutation

Four semantic errors remain: ORDER_PROCESSING→ORDER_PACKING, REFUNDED→RETURN, PAYMENT→INVOICE, OUT_FOR_DELIVERY→DELIVERED (unsafe).

Treat constrained semantic decoding as the V12 development output baseline. The frozen 180 remains evaluation-only and non-trainable; a new untouched post-V12 holdout is still required.

## V12 STAGE 1 — STUDENT HARD-CASE MINE SCORED

First local run on 144 new synthetic/deidentified cases:
- candidate SHA-256: `05d0ca898b2ccf5f75897d2930a500f960e29b1591a0ec1bb0c8996accae08fa`
- V11 student + constrained decoder: `142/144` exact vs seed
- disagreements: `2`
- unsafe: `0`
- teacher review queue: `14` = 2 disagreements + 12 agreement audits

Family results:
- `order_processing_vs_packing`: `22/24`, 2 disagreements
- `out_for_delivery_vs_delivered`: `24/24`
- `payment_vs_invoice`: `24/24`
- `return_vs_refunded`: `24/24`
- `shipment_created_vs_shipped`: `24/24`
- `shipped_vs_in_transit`: `24/24`

Local run:
`local-data/lora-v12/teacher-candidates-v1/runs/20260901T193717Z/`

The 144 cases are new TRAIN-candidate material, not evaluation holdouts. No external teacher was called and no training occurred.

## V12 STAGE 1B — OPENAI TEACHER REVIEW READY

Protocol: `protocols/V12-STAGE1-OPENAI-TEACHER-REVIEW-V1-2026-09-01.md`

Prepared an independent strong-teacher review of only the 14-case queue. Default teacher: `gpt-5.6-sol` via Responses API with strict JSON-schema output.

Important controls:
- teacher does NOT see seed label or student prediction before classifying;
- only rows explicitly marked synthetic + deidentified may be sent;
- `store=false`;
- API key from `OPENAI_API_KEY` only and never written to files;
- checkpoint/resume per case;
- teacher event, confidence, evidence sufficiency, response id and token usage are recorded;
- a row is approved only if teacher matches seed + evidence is sufficient + confidence HIGH;
- approved means source for later augmentation, NOT immediate TRAIN eligibility;
- no Purchase/Identity/Gmail/DB writes.

Files:
- `scripts/v12-teacher-review-openai-v1.py`
- `scripts/run-v12-teacher-review-openai-v1.ps1`
- `scripts/BuyFlow-V12-TEACHER-REVIEW.cmd`

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` into the separate test worktree.
2. Set `OPENAI_API_KEY` only in the user's local PowerShell environment; never paste it into chat or Git.
3. Run `scripts/BuyFlow-V12-TEACHER-REVIEW.cmd` on the 14-case synthetic queue.
4. Preserve the first `# SUMMARY` and inspect any teacher-vs-seed conflict before generating training data.
5. If the two student disagreements are independently confirmed as seed-correct, generate new sibling examples from that failure family and add representation-invariance variants.
6. Never train on Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50.
7. Qwen remains semantic-only; Zero-Trust Purchase Identity Graph remains authoritative.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
