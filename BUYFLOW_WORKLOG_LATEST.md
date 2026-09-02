# BuyFlow worklog latest

## 2026-09-02 — V12 Stage 4 untouched holdout: promotion FAIL; audit phase opens

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Final frozen one-shot generalization gate completed on SHA-locked post-training holdout:
- holdout SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- rows `108`, 18 events x 6
- V11 `105/108 = 97.22%`
- V12 `102/108 = 94.44%`
- delta exact `-3`
- invalid V11/V12 `0/0`
- both right `102`
- V12 wins `0`
- V11 wins `3`
- both wrong `3`
- changed predictions `3`

Per-event regressions in V12:
- DELAYED `6/6 -> 5/6`
- INVOICE `6/6 -> 5/6`
- SHIPPED `6/6 -> 5/6`

Per-language regressions:
- English `18/18 -> 17/18`
- Spanish `18/18 -> 16/18`

Per-variant regression is concentrated entirely in `stale_snippet`:
- V11 `16/18`
- V12 `13/18`
- delta `-3`

Wrong transitions:
- V11: PAYMENT->INVOICE x2; RETURN->REFUNDED x1
- V12: those same three plus DELAYED->DELIVERED x1; INVOICE->PAYMENT x1; SHIPPED->IN_TRANSIT x1

Decision: **V12 promotion FAIL**. The untouched holdout is the promotion authority. Do not promote V12 over V11 and never tune from this frozen holdout. Keep V11 as the better-supported adapter for now. Any future model cycle requires a new versioned untouched holdout.

Protocol:
`protocols/V12-STAGE4-UNTOUCHED-HOLDOUT-RESULT-2026-09-02.md`

This closes the V12 promotion gate. Next phase is the full BuyFlow module audit:
`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`.

---

## 2026-09-02 — V12 Stage 4 holdout FROZEN; one-shot compare prepared

Frozen before scoring:
- SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- 108 rows
- 18 labels x 6
- six languages, six representation variants
- model loaded at freeze `False`
- training/tuning eligible `False`
- protected holdouts/training corpus/hard siblings read `False`

---

## 2026-09-02 — V12 all-18 retention PASS: 288/288 for V11 and V12

Development retention comparison:
- V11 `288/288 = 100%`
- V12 `288/288 = 100%`
- all 18 labels `16/16` for both
- invalid `0/0`
- wrong transitions none/none

This was clean retention evidence but not broad improvement proof.

---

## 2026-09-02 — V12 hard-sibling post-train: 71/72

Exact V12 post-training evaluation on the same fixed 72 hard-sibling validation rows:
- V11 `70/72`
- V12 `71/72`
- delta `+1`
- ORDER_PROCESSING `34/36 -> 36/36`
- ORDER_PACKING `36/36 -> 35/36`
- one V12 `ORDER_PACKING -> ORDER_PROCESSING` stale-snippet error

---

## 2026-09-02 — V12 continuation QLoRA COMPLETE

- Qwen3-8B / AMD Radeon RX 9060 XT
- TRAIN 1296 / validation 360
- 324/324 optimizer steps
- LR `2e-5`, 1 epoch, grad_accum 4, max_seq 768
- train loss `0.000222`, validation loss `0.000007`
- V12 best adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- parent V11 unchanged
- frozen holdouts read `False`

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail foundation remains disabled by default with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286 API tests; browser visual smoke remains pending.
