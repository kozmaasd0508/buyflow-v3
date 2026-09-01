# BuyFlow worklog latest

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic prepared

Branch: `codex/v11-semantic-view-ab-v1`

First V11 Fresh Blind v1 result from the user's local GPU run:
- gate: FAIL
- exact: 163/180 = 90.56%
- commerce: 173/180 = 96.11%
- macro event accuracy: 90.56%
- invalid output: 7
- unsafe lifecycle promotions: 1
- OTHER -> commerce false positives: 0
- critical boundary errors: 10
- weakest groups: ORDER_PROCESSING 4/10, SHIPPED 5/10, OUT_FOR_DELIVERY 8/10, CANCELLED 8/10

The frozen fixture remains unchanged and must not be trained on.

Implemented a diagnostic input-representation A/B test:
- new deterministic `BuyFlowSemanticEmailViewV1` projection;
- retains sender, subject/snippet, received time, body text, visible HTML text, structured schema payloads, links and attachment metadata;
- drops provider/thread ids, recipient bookkeeping, raw headers/auth bookkeeping, folders, rawRef, normalizer version and trace id;
- same classifier instruction and same V11 adapter;
- reuses the preserved first Fresh Blind `predictions.jsonl` as the baseline, so only the semantic side needs GPU inference;
- strict existing scorer reused for exact, macro, invalid, unsafe, OTHER false-commerce and critical-boundary metrics;
- adds paired baseline-only vs semantic-only wins per case/event;
- diagnostic only: even a win requires a newly frozen untouched holdout before adoption;
- per-case partial JSONL checkpointing and automatic resume prevent loss if the terminal is closed;
- no training, no Purchase/Identity/Gmail/DB writes, no frozen108/BLIND50/real Gmail holdout reads.

Files:
- `scripts/v11_semantic_view_v1.py`
- `scripts/v11-semantic-view-ab-v1.py`
- `scripts/run-v11-semantic-view-ab-v1.ps1`
- `scripts/BuyFlow-V11-SEMANTIC-VIEW-AB.cmd`
- `protocols/V11-SEMANTIC-VIEW-AB-V1-2026-09-01.md`

Next gate:
1. run the SemanticEmailView A/B locally;
2. preserve the result unchanged;
3. if semantic view wins without safety regression, freeze a new untouched representation holdout before V12/adoption.

---

## 2026-08-31 — V11 Fresh Blind v1 frozen runner prepared

Branch: `codex/v11-fresh-blind-v1`

Implemented:
- froze a post-training V11 fresh blind protocol before inference;
- created 180 synthetic cases covering all 18 lifecycle labels, 10 per label;
- languages: hu/en/de/pl/fr/es;
- evaluates the actual production `NormalizedEmailDocumentV1` top-level representation rather than the simplified V11 synthetic training object;
- includes stale/misleading subject and snippet traps, HTML-only current state, structured identifier traps, quoted old states, future-state negatives, marketing noise and non-commerce Product/Offer traps;
- critical boundary scoring includes processing/packing, packing/shipment-created, shipment-created/shipped, shipped/in-transit, transit/out-for-delivery, out-for-delivery/delivered, pickup/delivered, delayed/delivery-failed, return/refund and payment/invoice;
- exact strict JSON output validation and unsafe-promotion counting;
- runner refuses V11 training evidence unless `frozen_108_trained`, `blind_50_trained`, `locked_test_read` and `locked_test_trained` are all false;
- no Purchase/Identity/Gmail/DB writes and no training behavior.

Frozen fixture SHA-256:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

Local preparation verification:
- all Python runner modules compile;
- `--freeze-only` regenerates 180 cases and the exact frozen SHA above;
- packaged ZIP passes archive integrity verification.

Important correction during preparation:
- an earlier monolithic GitHub runner blob contained invalid UTF-8 and an obsolete fixture hash;
- it was replaced by a clean modular runner and the protocol hash was corrected before any model inference.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft)

Direct Gmail OAuth/PKCE, encrypted refresh-token storage, incremental history/watch runtime, authenticated Pub/Sub wake-up handling and read-only Gmail shadow smoke are implemented behind disabled-by-default flags. No direct Gmail production cutover or live source migration has occurred.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)

Purchase-detail status/timeline/product rendering was consolidated, three legacy MutationObservers removed, stored product image preview added, shipment-facing UI renamed to **Csomagok**. Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests. Browser visual smoke remains pending.
