# BuyFlow V12 — Stage 4 Untouched Holdout Result

Date: 2026-09-02

## Frozen corpus

- holdout SHA-256: `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- rows: `108`
- events: `18`
- rows per event: `6`
- languages: `hu,en,de,pl,fr,es`
- variants: `clean_plain,stale_subject,html_only,stale_snippet,quoted_history,metadata_noise`
- V11 adapter SHA: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- V12 adapter SHA: `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- training: `False`
- corpus mutation: `False`
- protected holdouts read: `False`

## One-shot result

Overall:
- V11: `105/108 = 97.22%`
- V12: `102/108 = 94.44%`
- delta exact: `-3`
- invalid V11: `0`
- invalid V12: `0`
- both right: `102`
- V12 wins: `0`
- V11 wins: `3`
- both wrong: `3`
- changed predictions: `3`

Per-event V12 regressions versus V11:
- `DELAYED`: `6/6 -> 5/6`
- `INVOICE`: `6/6 -> 5/6`
- `SHIPPED`: `6/6 -> 5/6`

Shared non-regressed weaknesses:
- `PAYMENT`: V11 `4/6`, V12 `4/6`
- `RETURN`: V11 `5/6`, V12 `5/6`

Per-language deltas:
- `en`: `18/18 -> 17/18` (`-1`)
- `es`: `18/18 -> 16/18` (`-2`)
- all other languages delta `0`

Per-variant:
- clean_plain: `18/18 -> 18/18`
- stale_subject: `17/18 -> 17/18`
- html_only: `18/18 -> 18/18`
- stale_snippet: `16/18 -> 13/18` (`-3`)
- quoted_history: `18/18 -> 18/18`
- metadata_noise: `18/18 -> 18/18`

Wrong transitions:

V11:
- `PAYMENT -> INVOICE` x2
- `RETURN -> REFUNDED` x1

V12:
- `DELAYED -> DELIVERED` x1
- `INVOICE -> PAYMENT` x1
- `PAYMENT -> INVOICE` x2
- `RETURN -> REFUNDED` x1
- `SHIPPED -> IN_TRANSIT` x1

## Decision

**V12 promotion gate: FAIL.**

The development hard-sibling set improved by +1 and the 288-row retention set showed no forgetting, but the untouched post-training holdout is the promotion authority. On this frozen one-shot gate V12 is three exact cases worse than V11 and has zero V12-only wins.

Therefore:
- do not promote V12 over V11;
- do not tune on this frozen holdout;
- keep V11 as the current better-supported adapter for now;
- preserve V12 as an experimental branch/artifact and use the revealed `stale_snippet` regressions only as diagnostic evidence for a future separately versioned training cycle;
- any future model change requires a new untouched holdout version.

This closes the V12 promotion gate and allows the planned BuyFlow module-by-module audit to begin independently.
