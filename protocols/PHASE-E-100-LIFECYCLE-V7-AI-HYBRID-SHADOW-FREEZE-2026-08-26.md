# Phase E — 100 real lifecycle V7 AI hybrid shadow freeze

Date: 2026-08-26
Mode: private read-only Gmail/Nylas + OpenAI shadow benchmark
Production writes: forbidden

## Frozen population

V7 must reproduce the exact V6 source-order and lifecycle-ownership rules from `PHASE-E-100-LIFECYCLE-V6-SOURCE-EXPANSION-FREEZE-2026-08-26.md` in one process and select the first 100 qualifying multi-message journeys.

Before any AI score is accepted, the deterministic replay in the same process must reproduce the frozen V6 baseline invariants:
- 100 journeys;
- 340 discovered messages;
- 26 automatic CREATE_PURCHASE actions;
- 13 automatic LINK_EVENT actions;
- 0 wrong automatic cross-journey links;
- 0 duplicate automatic Purchase creates;
- 0 creates on explicit non-acceptance.

If the deterministic baseline does not reproduce, the AI comparison is invalid and must stop.

## Lanes

The same selected messages are replayed chronologically through three isolated in-memory Identity Graph snapshots:

1. `deterministic`: frozen Extraction Engine v2 only.
2. `luna`: deterministic evidence + GPT-5.6 Luna semantic evidence.
3. `hybrid`: deterministic evidence + Luna semantic evidence, except cases meeting the frozen fallback rule use an independent GPT-5.6 Sol verification result instead of Luna semantic evidence.

The Identity Graph, merchant namespace logic, purchase creation authority and promotion-readiness rules are identical across lanes.

## Model configuration

Primary model: `gpt-5.6-luna`
- Responses API
- `store: false`
- reasoning effort inherited from the existing safe extractor (`none`)
- strict Structured Outputs

Fallback model: `gpt-5.6-sol`
- same extraction contract and privacy settings
- `store: false`

## AI authority boundary

AI output is candidate evidence only. AI never directly:
- creates a Purchase;
- links an event;
- merges Purchases;
- mutates the benchmark snapshot;
- performs a production write.

The deterministic Identity Graph remains the only CREATE/LINK/REVIEW authority.

## Identifier gate

AI confidence alone can never make an identifier hard evidence.

An AI `order_number` claim may enter resolution only when its normalized value equals a structural `EmailDocumentV1.signals.orderNumbers` candidate from the same email.

An AI `tracking_number` claim may enter resolution only when its normalized value equals a structural `EmailDocumentV1.signals.trackingNumbers` candidate from the same email.

AI invoice/payment identifiers are not introduced as new hard identifiers in V7. Existing deterministic evidence remains authoritative for those fields.

Rejected/unverified AI identifiers are counted only in aggregate and are not sent to the graph.

## Semantic evidence

AI may add semantic event-type evidence and corroborative merchant/carrier/amount/product evidence only when it does not violate deterministic source-role restrictions. Deterministic higher-ranked evidence wins; same-rank incompatible evidence must resolve to conflict/REVIEW rather than silent override.

Carrier-source restrictions from the existing OpenAI extractor and Extraction Engine v2 remain in force.

## Frozen Sol fallback rule

Use Sol when any of the following is true after the Luna call:
- Luna confidence < 0.90;
- Luna event type is `other`;
- Luna proposes an order/tracking identifier that fails the V7 structural identifier gate;
- Luna event type conflicts with an already-resolved deterministic event type;
- the deterministic extraction is already review-required and Luna does not remove the semantic ambiguity safely.

Sol is an independent verifier: the hybrid lane uses the Sol semantic candidate rather than stacking Luna and Sol claims together.

## Safety hard-fail

Every lane hard-fails on:
- automatic LINKED decision to a Purchase owned by another benchmark journey;
- one journey receiving duplicate automatic Purchase creates;
- automatic Purchase creation on explicit non-acceptance;
- any production write.

The AI lanes additionally hard-fail if AI is allowed to write or bypass the deterministic promotion gate.

## Privacy

Never log or commit raw Gmail/Nylas ids, email addresses, subjects, bodies, order ids, tracking ids, payment references, transaction values, addresses or recipients.

Allowed logs:
- aggregate counts;
- token totals and estimated API cost;
- model call counts;
- aggregate fallback reasons;
- opaque hashes only when a case-level diagnostic is strictly required.

OpenAI API requests use `store: false`. No raw email data is committed to GitHub.

## Success criterion

Primary safety target: **0 wrong automatic links**.

Only after satisfying the safety target may coverage be compared with the frozen deterministic baseline (26 automatic Purchase journeys / 12 journeys with lifecycle links). The benchmark does not authorize production writes.