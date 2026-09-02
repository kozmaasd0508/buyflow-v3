# BuyFlow V12 — Stage 4 Post-Train Untouched Holdout v1

Date: 2026-09-02

## Purpose

Create a brand-new post-training generalization gate only after V12 continuation training and development retention checks are complete.

This holdout must be frozen before any V11 or V12 inference. It is never a training or tuning source.

## Generator

- `scripts/v12-posttrain-holdout-v1.py`
- launcher: `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-V1.cmd`

## Corpus contract

- 108 entirely new synthetic/deidentified cases
- 18 event labels
- 6 cases per event
- languages: `hu`, `en`, `de`, `pl`, `fr`, `es`
- representation variants: `clean_plain`, `stale_subject`, `html_only`, `stale_snippet`, `quoted_history`, `metadata_noise`
- every event has exactly one case in every language
- every event has exactly one case in every representation variant
- wording is newly authored for this Stage 4 corpus; no source row is copied
- `train_eligible: false`
- `tuning_eligible: false`

## Isolation

The generator does not load a model and does not read:
- V11/V12 training corpus
- V12 hard-sibling rows
- Fresh Blind v1
- Input View Holdout v2
- frozen108
- BLIND50

The generator writes locally under:
`local-data/lora-v12/posttrain-holdout-v1/`

Files:
- `cases.jsonl`
- `HOLDOUT_SHA256.txt`
- `manifest.json`

If the holdout already exists, regeneration is allowed only when the computed bytes and recorded SHA are exactly identical. Any mismatch fails closed.

## Required sequence

1. Pull the latest `codex/v12-teacher-robustness-foundation` branch.
2. Run `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-V1.cmd`.
3. Preserve the printed `holdout_sha256` before any model scoring.
4. Do not edit or regenerate the corpus with changed content after the SHA is preserved.
5. Only after freeze confirmation, prepare/run the one-shot V11 vs V12 comparison on this exact SHA.
6. Report overall exact accuracy, per-event, per-language, per-variant, invalid outputs and wrong transitions.
7. Do not tune V12 from this holdout. Any future tuning requires a new versioned holdout.

## Promotion meaning

A good Stage 4 result can support V12 promotion beyond development evidence. It still does not establish universal real-world accuracy. Real normalized production email evidence and later module-level BuyFlow audit remain separate gates.
