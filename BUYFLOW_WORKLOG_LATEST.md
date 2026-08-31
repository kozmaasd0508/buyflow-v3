# BuyFlow worklog latest

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

Current state:
- V11 training is complete and the `best` adapter exists on the user's machine;
- **Fresh Blind v1 has not yet been scored** because the adapter/GPU runtime is local to the user machine;
- first result must be preserved unchanged and the fixture must not be patched after scoring.

Next gate:
1. run `scripts/BuyFlow-V11-FRESH-BLIND.cmd` locally;
2. preserve first `metrics.json`;
3. only after that decide whether to open frozen108, BLIND50 and real Gmail holdout evaluation.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft)

Direct Gmail OAuth/PKCE, encrypted refresh-token storage, incremental history/watch runtime, authenticated Pub/Sub wake-up handling and read-only Gmail shadow smoke are implemented behind disabled-by-default flags. No direct Gmail production cutover or live source migration has occurred.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)

Purchase-detail status/timeline/product rendering was consolidated, three legacy MutationObservers removed, stored product image preview added, shipment-facing UI renamed to **Csomagok**. Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests. Browser visual smoke remains pending.
