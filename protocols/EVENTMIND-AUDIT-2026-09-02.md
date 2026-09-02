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

## V11 runtime safety layer — implemented, OFF by default

Added `apps/api/src/ai/eventmind-v11-runtime.ts` and `scripts/eventmind-v11-runtime.py`.

The runtime now has explicit safety rules:
- feature flag defaults OFF;
- exact V11 adapter SHA-256 is mandatory when enabled; there is no guessed/default adapter fingerprint;
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

Production EventMind remains OFF. The normalized inbound source lane is not changed to call Qwen automatically.

## New untouched representation gate — prepared, not yet GPU-scored

Added:
- `apps/api/src/ai/eventmind-v11-representation-gate.ts`
- `apps/api/src/scripts/eventmind-v11-representation-gate.ts`
- `apps/api/src/scripts/eventmind-v11-untouched-fixture-v1.ts`
- `scripts/run-eventmind-v11-gate.ps1`
- `scripts/BuyFlow-EVENTMIND-V11-GATE.cmd`

The gate deliberately rejects the already-viewed V11 Fresh Blind / SemanticEmailView A/B fixture SHA:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

The new synthetic representation fixture is created locally under Git-ignored `local-data/`, contains 90 cases (5 per each of the 18 event labels), and includes multilingual cases, stale snippet/subject traps, quoted old lifecycle history and structured lifecycle/identity noise.

Important: this 90-case fixture is a fresh **representation/runtime gate**, not proof of broad real-mailbox generalization.

Before the first inference call the runner:
1. reads the complete fixture;
2. calculates its SHA-256;
3. rejects known/reused fixture hashes;
4. requires all 18 event labels and at least 90 cases;
5. freezes the exact fixture locally;
6. writes a `FROZEN_BEFORE_INFERENCE` manifest;
7. then calls the pinned V11 runtime.

A fixture hash already consumed by a previous local gate run is rejected, preventing silent reruns after viewing results.

Gate PASS requires:
- at least 90 cases;
- all 18 events present;
- invalid output = 0;
- incoherent output = 0;
- unsafe lifecycle promotion = 0;
- OTHER -> commerce false positives = 0;
- exact accuracy >= 90%;
- macro event accuracy >= 85%.

The gate never trains the model and the fixture is marked `doNotTrainOnFixture`.

## One-click local run

The user's local machine owns the actual V11 adapter/GPU, so the final model gate cannot be executed from GitHub CI.

Run:

`scripts/BuyFlow-EVENTMIND-V11-GATE.cmd`

This one command:
- creates the new fixture if it does not already exist;
- starts the pinned local V11 server in WSL;
- reads the actual adapter SHA from the server health response;
- verifies Qwen3-8B + thinking OFF + deterministic mode;
- runs the 90-case MailLens/EventMind gate;
- prints PASS/FAIL;
- stops the local model server afterward.

It does not enable production EventMind and does not train V11.

## Verification state

Runtime/gate source is covered by:
- Python syntax check;
- PowerShell launcher parser check;
- API strict TypeScript typecheck;
- API tests;
- API build;
- mobile typecheck/build.

The exact final CI head/run is recorded in the handoff/worklog after the verification-only PR completes.

## Verdict

- **EventMind MailLens / identity boundary: PASS**
- **V11 runtime safety code: PASS pending final exact-head CI record**
- **Fresh V11 representation gate: PREPARED / NOT RUN ON LOCAL GPU YET**
- **Production EventMind: BLOCKED**

Production stays blocked until the local one-click V11 gate is actually run and its first untouched result is preserved/reviewed. A synthetic gate PASS is useful runtime/representation evidence but must not be overstated as complete real-world generalization proof.

## Safety state

Unchanged:
- EventMind production flag OFF by default;
- no production Qwen wiring in normalized inbound processing;
- no provider cutover;
- no Purchase/Shipment/Document write authority change;
- no AI identity authority;
- V12 remains unpromoted;
- private fixtures/results live under Git-ignored `local-data/`.
