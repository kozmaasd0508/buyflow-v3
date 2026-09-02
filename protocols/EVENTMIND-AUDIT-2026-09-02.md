# EventMind audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Scope

EventMind answers only:

> What concrete commerce/lifecycle event does the current email express?

It must never answer or influence:

> Which Purchase does this belong to?

Audit scope covered the current V11 Qwen reference, prompt/ontology, 18-event output schema, decoder behavior, model-input representation, semantic overlay boundary and all direct/indirect Purchase identity authority paths.

## Reference V11 findings

Current reference model remains Qwen3-8B + V11 QLoRA. V12 remains unpromoted.

The V11 evaluation runtime is deterministic:
- local-only model files;
- 4-bit NF4 adapter loading;
- inference mode;
- `do_sample=false`;
- bounded `max_new_tokens`;
- GPU required;
- adapter training metrics/isolation flags are checked before evaluation;
- adapter model SHA-256 is recorded by evaluation runs.

Historical V11 decoder already accepted only exactly `is_commerce` + `event_type` with the fixed 18-event vocabulary. Historical evaluation scoring separately measured incoherent commerce/event pairs, invalid JSON/schema, unsafe lifecycle promotion and critical sibling-boundary errors.

Important runtime caveat: the V11 tokenizer helper disables Qwen thinking when the installed tokenizer supports `enable_thinking=false`, but its compatibility fallback omits that flag. A future production runtime must pin/verify the tokenizer/template behavior instead of silently accepting a thinking-enabled fallback.

## 18-event ontology

Locked taxonomy:

1. `ORDER_CREATED`
2. `ORDER_PROCESSING`
3. `ORDER_PACKING`
4. `SHIPMENT_CREATED`
5. `SHIPPED`
6. `IN_TRANSIT`
7. `OUT_FOR_DELIVERY`
8. `READY_FOR_PICKUP`
9. `DELIVERED`
10. `DELIVERY_FAILED`
11. `DELAYED`
12. `CANCELLED`
13. `REFUNDED`
14. `PAYMENT`
15. `INVOICE`
16. `RETURN`
17. `WARRANTY`
18. `OTHER`

No Purchase/merchant/order/tracking/invoice/payment identity field is part of the model output ontology.

## Remediation added on PR #295

### 1. One MailLens-only EventMind input

Added `apps/api/src/ai/eventmind-v1.ts`.

`buildEventMindInputV1(...)` accepts only an already-normalized `NormalizedEmailDocumentV1` from MailLens. It does not reparse provider HTML/body and does not create a second source normalizer.

The EventMind input contains only:
- subject;
- sender address/name;
- received time;
- MailLens `semanticText`;
- semantic truncation / quoted-history flags;
- bounded structured lifecycle hints.

It deliberately omits:
- provider message/thread ids;
- recipients;
- snippet;
- full `bodyText`;
- raw HTML;
- raw headers/authentication;
- folders;
- links/hrefs;
- attachment metadata;
- raw archive reference;
- trace id;
- internal Purchase ids/candidate lists.

Structured-data projection removes common identity-bearing keys (`orderNumber`, tracking/order/invoice/payment ids/references, URLs/hrefs, candidate/Purchase ids, etc.) while retaining bounded status/state hints such as `orderStatus` or `trackingStatus`.

The older standalone Python `v11_semantic_view_v1.py` is therefore diagnostic/history only and must not become the production EventMind source representation.

### 2. Explicit production EventMind prompt contract

The new prompt contract states that EventMind:
- classifies only the latest concrete lifecycle state;
- consumes current MailLens semantics;
- treats identifiers as non-state evidence;
- has no authority to create/link/merge/select/identify a Purchase;
- must output JSON with exactly two keys: `is_commerce`, `event_type`.

### 3. Strict fail-closed decoder

Added `decodeEventMindPredictionV1(...)`.

The decoder rejects:
- invalid JSON;
- non-object/schema mismatch;
- any extra output key;
- non-boolean `is_commerce`;
- unknown event label;
- incoherent `OTHER=true` or non-`OTHER=false` combinations.

An attempted extra identity field such as `purchase_id`, `order_id` or `tracking_number` invalidates the entire model response rather than being ignored.

### 4. Generic semantic-only overlay boundary

Added `purchase-identity-v2/semantic-event-overlay.ts` and retained backwards-compatible V9 wrappers.

The common overlay API accepts only:
- semantic event type;
- commerce boolean;
- model provenance (`sourceId`, `sourceVersion`).

It neither accepts nor returns identity values.

EventMind V1 maps a decoded V11 result into this semantic-only override with source id `qwen3-8b-buyflow-v11`.

Existing Identity Graph boundary remains unchanged:
- all order/tracking/invoice/payment/merchant/carrier values remain deterministic Extraction v2 evidence;
- semantic provenance is `semantic_only`, `non_authoritative`, `no_identity_evidence_from_ai`;
- hard identity conflicts remain REVIEW/PENDING;
- NEW_PURCHASE requires independent deterministic purchase-creation authority, hard order identity and merchant/source evidence;
- an AI lifecycle label cannot authorize Purchase creation/link/merge.

## Regression coverage

Added `apps/api/src/ai/eventmind-v1.test.ts` covering:
- quoted old lifecycle history cannot enter EventMind semantic text;
- stale snippet does not enter the model input;
- provider/thread ids, recipients/private archive/trace/header/attachment metadata do not enter model input;
- structured order/tracking identity values and URLs are removed while lifecycle status hints remain;
- taxonomy is exactly 18 labels;
- extra `purchase_id` output -> `INVALID_SCHEMA`;
- invalid event -> reject;
- commerce/event incoherence -> reject;
- malformed JSON -> reject;
- successful V11 decode produces only semantic override keys and no Purchase/order/tracking identity field.

## Verification

Exact behavior code head:

`1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`

Temporary CI-only PR #303 / GitHub Actions CI #1152, run `33632992124`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #303 was closed unmerged after verification.

## Verdict

### EventMind code contract / identity-authority remediation: PASS

The source representation, prompt boundary, output decoder and semantic overlay now have a production-side fail-closed contract that cannot carry internal Purchase identity authority.

### Production EventMind runtime: BLOCKED

No Qwen/V11 runtime was enabled or wired by this audit. `aiCalls` in the current normalized-inbound source lane remain zero.

Before any production EventMind enablement, all of the following remain mandatory:

1. Wire the actual V11 runtime only through `buildEventMindInputV1(...)` + `decodeEventMindPredictionV1(...)`.
2. Pin the exact base model/tokenizer/template and adapter SHA-256; do not resolve production authority from a mutable `LATEST.txt` pointer.
3. Fail closed on model unavailable/OOM/timeout/invalid output: no semantic override, no write authority escalation, REVIEW where needed.
4. Verify thinking is explicitly disabled; no silent tokenizer compatibility fallback may change output mode.
5. Run a new untouched representation gate against the exact MailLens/EventMind V1 input. The already-used 180-case SemanticEmailView A/B is diagnostic only and cannot prove promotion readiness.
6. Preserve the V11/V12 frozen holdouts from tuning contamination.
7. Add runtime observability for model/adapter hash, contract/decoder version, latency, invalid/failure reason and event result without logging raw/private email bodies.
8. Keep Purchase Identity Graph v2 as the sole identity/linking authority.

## Safety state

Unchanged:
- no EventMind/Qwen production wiring;
- no live/source flag enabled;
- no provider cutover;
- no Purchase/Shipment/Document write authority change;
- no AI identity authority;
- V12 remains unpromoted.
