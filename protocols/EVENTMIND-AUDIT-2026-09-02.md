# EventMind audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Scope

EventMind answers only:

> What concrete commerce/lifecycle event does the current email express?

It must never answer or influence:

> Which Purchase does this belong to?

Current reference model remains Qwen3-8B + V11 QLoRA. V12 remains unpromoted.

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

## MailLens / identity boundary — PASS

`apps/api/src/ai/eventmind-v1.ts` is the production-side EventMind input/decoder contract.

EventMind receives an already-normalized MailLens document. Its current semantic body is `semanticText`; stale quoted history, stale snippet and raw HTML do not get a separate path around MailLens.

The input omits provider/thread ids, recipients, raw headers/authentication, folders, attachment metadata, archive refs, trace ids and internal Purchase ids/candidate lists. Bounded structured lifecycle hints are allowed, while common identity-bearing structured fields/URLs are removed.

The prompt explicitly denies Purchase create/link/merge/select/identify authority.

The decoder accepts exactly two fields:
- `is_commerce`
- `event_type`

Any extra output field such as `purchase_id` invalidates the model response. The shared semantic overlay contains only event semantics + model provenance and never identity.

Purchase Identity Graph v2 remains the sole identity/linking/creation authority.

Initial boundary behavior head:
`1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`

CI #1152 / run `33632992124` was GREEN. Temporary PR #303 was closed unmerged.

## V11 runtime safety layer — PASS, OFF by default

Added `apps/api/src/ai/eventmind-v11-runtime.ts` and `scripts/eventmind-v11-runtime.py`.

The runtime has explicit safety rules:
- feature flag defaults OFF;
- exact V11 adapter SHA-256 is mandatory when enabled;
- expected base model is `Qwen/Qwen3-8B`;
- runtime and template versions are checked on every successful response;
- local HTTP is allowed only on loopback; remote runtime must use HTTPS;
- thinking must be explicitly disabled; tokenizer compatibility fallback is not accepted;
- generation is deterministic (`do_sample=false`, `max_new_tokens=48`);
- local server loads model files only from local cache and requires GPU;
- training completion + V11 holdout-isolation flags are verified before model loading;
- local server calculates and reports the real adapter SHA-256;
- API accepts a model response only if model id, adapter SHA, runtime version, template version, thinking-off and deterministic flags all match;
- timeout remains active through response-body parsing;
- unavailable runtime, timeout, HTTP failure, malformed response, metadata mismatch, OOM or invalid model output fail closed;
- runtime failures never create identity authority;
- prompts/raw email bodies are not logged by the local model server.

Final exact branch verification before the local GPU gate:
`af99492f4e852250b5a8fb05f1167336dd50c419`

GitHub Actions CI #1167 / run `33635810471` passed Python/PowerShell syntax checks, API typecheck/tests/build and mobile typecheck/build. Temporary PR #304 was closed unmerged.

Production EventMind remains OFF. The normalized inbound source lane is not changed to call Qwen automatically.

## Untouched representation/runtime gate — PASS

The fresh local synthetic representation fixture contains 90 cases, 5 per each of the 18 labels. It includes multilingual examples, stale subject/snippet traps, quoted old lifecycle history and structured lifecycle/identity noise.

The gate rejects the previously viewed fixture SHA:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`.

Before inference the new fixture was frozen and hashed. First untouched GPU inference completed on 2026-09-02.

Frozen fixture SHA-256:
`4d70c774b332edbc7aabe19d754f51ac2e47762c3d17cc018f25d4786d91fd0e`

Real adapter SHA-256 reported by the pinned V11 runtime:
`462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`

First preserved result:
- cases: **90/90**;
- Exact: **100.00%**;
- Macro event: **100.00%**;
- Invalid: **0**;
- Unsafe promotions: **0**;
- Gate: **PASS**.

Local result directory:
`local-data/eventmind-v11-representation-gate/runs/20260902T150955Z`

This fixture is now evaluation-only and must never be used for training.

Important: this synthetic gate is strong evidence that the pinned MailLens -> EventMind V11 runtime/representation path behaves correctly on the frozen coverage set. It is not complete proof of broad real-mailbox generalization.

## Verdict

- **EventMind MailLens / identity boundary: PASS**
- **V11 runtime safety code: PASS**
- **Fresh V11 representation/runtime gate: PASS — 90/90**
- **Production EventMind: BLOCKED / OFF**

EventMind is sufficiently clean to move the architecture audit to the next module, **TrustLink**, while keeping production enablement blocked.

## Safety state

Unchanged:
- EventMind production flag OFF by default;
- no production Qwen wiring in normalized inbound processing;
- no provider cutover;
- no Purchase/Shipment/Document write authority change;
- no AI identity authority;
- V12 remains unpromoted;
- private fixtures/results live under Git-ignored `local-data/`;
- MailGate/RawVault production smokes are still required before source cutover.
