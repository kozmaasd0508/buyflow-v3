# EventMind REAL120 chunk + short-evidence final judge — technical log

**Date:** 2026-09-04 Europe/Budapest  
**Dataset:** REAL120 development set, not blind holdout  
**Frozen ID SHA256:** `88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470`  
**Production:** OFF / unchanged  
**Gmail:** GET-only

## Why this run existed

The prior whole-email V13-lite path showed a severe system-RAM spike on REAL120 #45. A targeted chunk + short-evidence final-judge diagnostic solved that single case correctly and stably. This run tested that same architecture across all 120 known REAL120 development cases.

REAL120 ground truth is already known, so this is development scoring only. It must not be described as fresh blind validation.

## Runtime/input design

- chunk max: 3000 chars
- chunk overlap: 250 chars
- max chunks: 24
- max judge prompt: 9000 chars
- memory guard: 92%
- DIRECT local method
- local Qwen/Qwen3-8B V11 adapter/runtime
- no TestLab/self-hosted GPU runner
- checkpointed execution
- Qwen restarted in bounded segments by the PowerShell supervisor
- no automatic retry cascade on timeout/503
- final judge receives short redacted lifecycle evidence + chunk labels, not the whole email again.

## Technical result

Report completed all 120 cases.

- attempted: **120/120**
- final judge OK: **119**
- final judge errors: **1**
- final-judge valid-output rate: **99.17%**
- chunk invalid outputs: **10**
- runtime restart failures (timeout/503): **0**
- max observed system memory used: **80.3%**
- complete: **true**

This is a major technical improvement versus the V11 REAL120 baseline, which had 84 valid outputs / 36 invalid-or-runtime errors.

The 10 chunk invalids were all `INVALID_MODEL_OUTPUT / COMMERCE_INVARIANT_MISMATCH`. The final judge still completed all affected cases except the independent aggregate-size guard failure below.

### Only final-judge error

REAL120 index 2:
- source semantic text: 30028 chars
- chunks: 13
- aggregate judge prompt: 10950 chars
- guard result: `JUDGE_PROMPT_TOO_LARGE`
- configured max judge prompt: 9000 chars.

This was a deliberate bounded-input guard, not a GPU timeout/503. Fix by prioritizing/bounding aggregate evidence, not by simply increasing the memory limit.

## Semantic score vs known REAL120 human ground truth

### Headline

- strict exact: **44/120 = 36.67%**
- valid final outputs: 119/120
- accuracy among valid final outputs: **44/119 = 36.97%**
- buyer-commerce: **40/76 = 52.63%**
- OTHER: **4/44 = 9.09%**.

### Comparison with V11 baseline

V11 baseline:
- strict exact 41/120 = 34.17%
- valid outputs 84/120
- buyer-commerce exact 38/76 = 50.0%
- OTHER exact 3/44 = 6.82%.

Chunk+judge delta:
- strict exact: **+3 cases / +2.50 percentage points**
- valid-output rate: **70.0% -> 99.17%**
- buyer-commerce: **+2 correct / +2.63 pp**
- OTHER: **+1 correct / +2.27 pp**.

Interpretation: the architecture solved most technical validity/runtime problems, but semantic correctness barely improved. It is not promotion-ready.

## Per-ground-truth-class result

| Ground truth | Correct / Total | Strict accuracy | V11 strict baseline |
|---|---:|---:|---:|
| DELIVERED | 4/4 | 100.00% | 100.00% |
| INVOICE | 2/2 | 100.00% | 100.00% |
| IN_TRANSIT | 1/6 | 16.67% | 16.67% |
| ORDER_CREATED | 2/6 | 33.33% | 16.67% |
| ORDER_PACKING | 3/4 | 75.00% | 100.00% |
| ORDER_PROCESSING | 4/4 | 100.00% | 100.00% |
| OTHER | 4/44 | 9.09% | 6.82% |
| OUT_FOR_DELIVERY | 11/11 | 100.00% | 90.91% |
| PAYMENT | 5/13 | 38.46% | 46.15% |
| READY_FOR_PICKUP | 3/3 | 100.00% | 0.00% |
| SHIPMENT_CREATED | 1/11 | 9.09% | 54.55% |
| SHIPPED | 4/12 | 33.33% | 0.00% |

Key conclusion: READY_FOR_PICKUP, OUT_FOR_DELIVERY and SHIPPED improved, but SHIPMENT_CREATED regressed severely and OTHER remains the dominant failure group.

## Dominant confusion patterns

Most frequent wrong final outputs:
- OTHER -> ORDER_CREATED: **20**
- OTHER -> OUT_FOR_DELIVERY: **15**
- OTHER -> READY_FOR_PICKUP: **5**
- PAYMENT -> INVOICE: **4**
- SHIPPED -> SHIPMENT_CREATED: **4**
- SHIPMENT_CREATED -> READY_FOR_PICKUP: **4**
- SHIPMENT_CREATED -> ORDER_PACKING: **4**
- IN_TRANSIT -> ORDER_PROCESSING: **3**.

The main development problem therefore remains direction/role semantics: courier lifecycle language inside merchant/outbound emails is still being treated as buyer-side purchase lifecycle too often. The final judge also over-promotes some pre-shipment/merchant operational states to later buyer lifecycle events.

## Correctness movement relative to V11

Newly corrected indexes that were wrong in V11: 9, 14, 39, 45, 91, 97, 103, 105, 112, 115, 119.

Previously correct in V11 but now wrong: 4, 12, 37, 60, 96, 99, 101, 108.

Net gain = 11 improvements - 8 regressions = **+3 strict-exact cases**.

## Safety evidence

Report states:
- Gmail HTTP methods: GET
- mailbox mutations: 0
- BuyFlow DB writes: 0
- production flags enabled: false
- raw Gmail IDs persisted in report: false
- message content persisted in report: false
- final-judge evidence text persisted in report: false.

No production cutover or production migration was performed.

## Decision

**DO NOT PROMOTE / DO NOT FREEZE THIS CANDIDATE YET.**

Technical stability is good enough to continue development. Semantic accuracy is not.

## Exact next development work

1. Keep the current chunk/memory architecture; do not revert to whole-email processing.
2. Fix aggregate evidence sizing so index 2 stays under the 9000-char judge bound without raising memory limits.
3. Add stronger direction/role evidence to the final judge for merchant/outbound courier operations -> OTHER.
4. Separate SHIPMENT_CREATED from SHIPPED/later-stage evidence without sacrificing the READY_FOR_PICKUP and OUT_FOR_DELIVERY gains.
5. Re-run REAL120 only as development scoring.
6. Freeze the candidate only after material semantic improvement with current runtime stability preserved.
7. Then create a completely new untouched holdout for unbiased validation.
