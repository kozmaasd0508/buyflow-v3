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

Pre-train V11 on the fixed 72:
- `70/72 = 97.22%`
- ORDER_PROCESSING `34/36`
- ORDER_PACKING `36/36`
- only error direction `ORDER_PROCESSING -> ORDER_PACKING` x2

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
- training time `66.36 min`
- GPU peak `10.13 GiB`
- V12 best adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- parent V11 unchanged `True`
- frozen/protected holdouts read `False`

## V12 POST-TRAIN DEVELOPMENT RESULTS

Fixed 72 hard siblings:
- V11 `70/72`
- V12 `71/72`
- delta `+1`
- ORDER_PROCESSING `34/36 -> 36/36`
- ORDER_PACKING `36/36 -> 35/36`
- remaining V12 error: `ORDER_PACKING -> ORDER_PROCESSING` x1 on `stale_snippet`

All-18 retention compare on 288 V11 replay validation rows:
- V11 `288/288 = 100%`
- V12 `288/288 = 100%`
- every label `16/16` for both
- invalid `0/0`
- wrong transitions none/none
- conclusion: clean development retention PASS, but not broad improvement proof

## V12 STAGE 4 — UNTOUCHED HOLDOUT FROZEN

The post-training holdout was created and SHA-frozen before any V11/V12 scoring.

Freeze evidence:
- status `V12_POSTTRAIN_HOLDOUT_V1_FROZEN`
- SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- rows `108`
- 18 labels x 6 rows
- languages `hu,en,de,pl,fr,es`
- variants `clean_plain`, `stale_subject`, `html_only`, `stale_snippet`, `quoted_history`, `metadata_noise`
- complete event x language matrix
- complete event x variant matrix
- synthetic/deidentified `True`
- source rows copied `False`
- training/tuning eligible `False`
- model loaded at freeze `False`
- V11 scored at freeze `False`
- V12 scored at freeze `False`
- protected holdouts read `False`
- prior training corpus read `False`
- prior hard-sibling rows read `False`

Local fixture:
`local-data/lora-v12/posttrain-holdout-v1/cases.jsonl`

Protocol:
`protocols/V12-STAGE4-HOLDOUT-FROZEN-AND-COMPARE-PREP-2026-09-02.md`

## ONE-SHOT V11 VS V12 COMPARE PREPARED

Prepared only after the SHA was frozen:
- `scripts/v12-posttrain-holdout-compare-v1.py`
- `scripts/run-v12-posttrain-holdout-compare-v1.ps1`
- `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-COMPARE.cmd`

Compare contract:
- exact holdout SHA required
- exact V11 and V12 adapter SHAs required
- constrained decoding
- no training or corpus mutation
- no Fresh Blind / Input View Holdout / frozen108 / BLIND50 reads
- no per-case result shown until both models complete
- reports overall, per-event, per-language, per-variant, invalids and wrong transitions
- refuses a second completed run if `FINAL_RESULT.json` already exists

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate V11 test worktree.
2. Run `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-COMPARE.cmd` **once**.
3. Preserve the full `# SUMMARY`, `# BY_EVENT`, `# BY_LANGUAGE`, `# BY_VARIANT`, and both WRONG_TRANSITIONS blocks.
4. Never tune from this frozen holdout. Any future model change requires a new versioned holdout.
5. Decide V12 promotion only after this untouched result.
6. After the V12 gate closes, start the full BuyFlow module audit: MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
