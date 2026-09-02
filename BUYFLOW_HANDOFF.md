# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Modern email source:** PR #295 (draft)  
**Mobile cleanup:** PR #297 (draft)  
**V12 robustness foundation:** `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

## SAFETY CONTRACT

- Qwen classifies commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Frozen evaluation rows remain non-trainable.
- Direct Gmail/source archive/Mailgun source persistence stay OFF by default.
- No raw customer email content or secrets in Git.

## V11 BASELINE EVIDENCE

Qwen3-8B V11 QLoRA:
- TRAIN `5760`, validation `576`, 18 labels, multilingual
- optimizer steps `1440/1440`
- best in-family validation loss about `0.000015`
- parent adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`

Earlier generalization evidence:
- Fresh Blind v1 `163/180`, invalid `7`, unsafe `1`, gate FAIL
- Input View Holdout v2 FULL `170/180`, SEMANTIC `169/180`, MINIMAL `168/180`
- Stage 0 constrained decoder on frozen FULL: `176/180`, invalid `0`, unsafe `1`

Protected old holdouts remain frozen/non-trainable.

## V12 HARD-BOUNDARY DEVELOPMENT

Human teacher confirmed the weak family `ORDER_PROCESSING vs ORDER_PACKING` and the rule:
**explicit current body evidence + explicit negation of the next lifecycle step overrides stale/misleading subject or snippet.**

Hard sibling corpus:
- 216 rows = 144 TRAIN + 72 validation
- 6 languages / 6 representation variants
- semantic-group overlap `0`
- corpus SHA `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`

Pre-train V11 on fixed 72: `70/72 = 97.22%`.
Post-train V12 on same 72: `71/72 = 98.61%` (+1), but one reverse `ORDER_PACKING -> ORDER_PROCESSING` stale-snippet error appeared.

## V12 RETENTION REPLAY + TRAINING

Retention corpus:
- replay TRAIN `1152` + hard TRAIN `144` = `1296`
- replay validation `288` + hard validation `72` = `360`
- all 18 labels retained
- exact TRAIN/validation overlap `0`
- TRAIN SHA `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`

V12 continuation QLoRA complete:
- Qwen3-8B NF4
- 1 epoch, LR `2e-5`, grad_accum `4`, max_seq `768`
- optimizer steps `324/324`
- train loss `0.000222`
- validation loss `0.000007`
- V12 best adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- parent V11 unchanged `True`
- frozen/protected holdouts read `False`

All-18 development retention compare on 288 V11 replay validation rows:
- V11 `288/288 = 100%`
- V12 `288/288 = 100%`
- every label `16/16` for both
- invalid `0/0`
- wrong transitions none/none
- conclusion: clean development retention PASS, but not broad improvement proof

## V12 STAGE 4 — UNTOUCHED HOLDOUT FINAL RESULT

Frozen before inference:
- holdout SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- 108 rows, 18 labels x 6
- languages `hu,en,de,pl,fr,es`
- variants `clean_plain`, `stale_subject`, `html_only`, `stale_snippet`, `quoted_history`, `metadata_noise`
- training/tuning eligible `False`
- no model loaded at freeze
- no protected holdout/training/hard-sibling corpus read

One-shot unchanged V11 vs exact V12:
- V11 `105/108 = 97.22%`
- V12 `102/108 = 94.44%`
- delta `-3`
- invalid `0/0`
- V12 wins `0`
- V11 wins `3`
- both wrong `3`
- all three new regressions are `stale_snippet` cases
- per-event regressions: `DELAYED -1`, `INVOICE -1`, `SHIPPED -1`
- language regressions: English `-1`, Spanish `-2`

Wrong transitions:
- V11: `PAYMENT -> INVOICE` x2; `RETURN -> REFUNDED` x1
- V12: same three plus `DELAYED -> DELIVERED` x1, `INVOICE -> PAYMENT` x1, `SHIPPED -> IN_TRANSIT` x1

**Decision: V12 promotion FAIL.**
The untouched holdout is the promotion authority. V12 is not promoted. V11 remains the better-supported adapter for now. Never tune from the frozen Stage 4 holdout; any future model cycle requires a new versioned holdout.

Protocol:
`protocols/V12-STAGE4-UNTOUCHED-HOLDOUT-RESULT-2026-09-02.md`

## NEXT ACTION — FULL BUYFLOW AUDIT

The V12 promotion gate is closed. Begin the planned module-by-module audit independently:

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

For each module:
1. define exact role / must / must-not contract;
2. map all relevant code and runtime boundaries;
3. trace input -> output and failure paths;
4. inspect loss, unsafe fallback, duplication, retry/idempotency and privacy/security behavior;
5. run unit + edge/adversarial + realistic integration tests;
6. classify findings `PASS / FIX / BLOCKED` with exact evidence;
7. move to the next module only when the current audit gate is explicit.

Do not interpret `100%` as universal future-email accuracy; it means 100% of the defined contract/test gate plus fail-safe handling of uncertainty.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
