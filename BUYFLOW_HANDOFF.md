# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Source/audit branch:** `codex/modern-email-source-foundation-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI may classify commerce/lifecycle semantics only; it never grants hard Purchase identity.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime defaults OFF.
- Source archive defaults OFF.
- Mailgun source persistence defaults OFF.
- EventMind V11 production runtime defaults OFF.
- No provider production cutover or Purchase/Shipment/Document/Identity authority change has been made from this audit.
- Raw/private email fixtures and local model results stay out of Git.

## MODULE AUDIT ORDER

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

V11 remains the reference semantic model. V12 is not promoted.

## MAILGATE

Code remediation: **PASS**.

Implemented safe initial snapshot/cursor handling, detached Gmail body hydration, timestamp fail-closed behavior, bounded retry/concurrency, expired-history recovery, watch renewal/fallback sync and strict OAuth authority.

Production MailGate: **BLOCKED** pending controlled real-Gmail read-only shadow smoke.

Behavior head: `e67b908e07d072e3737611eca4ee804d7d905c26`.

## RAWVAULT

Code remediation: **PASS**.

Immutable raw/normalized archive, SHA-256 identity, pre-write manifest, explicit retention, crash/orphan/account-deletion cleanup, raw-hash conflict detection and DB immutability are implemented.

Production RawVault: **BLOCKED** pending controlled staging migration + explicit retention policy + real private-storage cleanup smoke.

Behavior head: `9480e6d4e8d5c3e0a771b43671503cda593971c2`.

## MAILLENS

Code remediation: **PASS**.

MailLens `normalized-email-document-v1.1` is the single semantic normalization boundary. It keeps bounded full `bodyText` plus current `semanticText`, excludes safely detected quoted history from current semantics, filters common hidden/preheader HTML, prevents attachment body injection and keeps header auth diagnostic-only (`trusted:false`).

MailLens behavior head: `f69195404831323f2783464a61f6f7b7435698b5`.

CI #1151 / run `33631564933`: API typecheck/tests/build + mobile typecheck/build PASS.

Production source path remains blocked behind MailGate + RawVault live/staging gates.

## EVENTMIND

Role: answer **“Mi történt ebben az emailben?”**, never **“Melyik vásárláshoz tartozik?”**

### Identity/input boundary — PASS

`apps/api/src/ai/eventmind-v1.ts` is the only production-side EventMind input/decoder contract.

- input comes from MailLens;
- current `semanticText` is used instead of stale quoted history;
- fixed 18-event taxonomy;
- prompt denies Purchase identity authority;
- decoder accepts exactly `is_commerce` + `event_type`;
- extra identity output such as `purchase_id` invalidates the whole response;
- semantic overlay carries only event semantics + model provenance;
- Purchase Identity Graph v2 remains the sole identity/linking/creation authority.

Initial boundary behavior head: `1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`.

CI #1152 / run `33632992124` PASS. Temporary PR #303 closed unmerged.

### V11 runtime safety — IMPLEMENTED, STILL OFF

Added a pinned local V11 runtime:
- `apps/api/src/ai/eventmind-v11-runtime.ts`
- `scripts/eventmind-v11-runtime.py`

Safety behavior:
- EventMind runtime flag defaults OFF;
- exact adapter SHA-256 required when enabled;
- model must report `Qwen/Qwen3-8B`;
- runtime/template versions must match;
- thinking must be explicitly OFF; no silent compatibility fallback;
- deterministic generation (`do_sample=false`, max 48 new tokens);
- local server checks V11 training completion + holdout-isolation flags and calculates the real adapter SHA;
- timeout covers request + response parsing;
- unavailable/OOM/timeout/HTTP/malformed/metadata mismatch/invalid model output all fail closed;
- no identity authority is granted on any failure.

Runtime safety behavior head before documentation commits:
`a3539e08927b9d6013c0b15ff6b4222df8c26211`.

### Fresh MailLens/EventMind V11 gate — PREPARED, NOT GPU-RUN YET

A new local 90-case gate is prepared. It has 5 cases for each of the 18 labels and includes multilingual messages, stale subject/snippet traps, quoted old states and structured noise.

It explicitly rejects the already-viewed 180-case fixture SHA:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`.

Before inference the new fixture is SHA-256 frozen and stored only under Git-ignored `local-data/`. A previously consumed local fixture hash cannot be reused silently.

Gate PASS requires:
- all 18 labels;
- >=90 cases;
- invalid output 0;
- incoherent output 0;
- unsafe lifecycle promotion 0;
- OTHER -> commerce FP 0;
- exact >=90%;
- macro event >=85%.

### One command for the user's PC

Run:

`scripts/BuyFlow-EVENTMIND-V11-GATE.cmd`

It creates the fresh fixture, starts the local V11 model, verifies model + actual adapter SHA + thinking OFF, runs the gate, prints PASS/FAIL, then stops the model server.

It does **not** train V11 and does **not** enable production EventMind.

Protocol: `protocols/EVENTMIND-AUDIT-2026-09-02.md`.

Current status:
- **EventMind identity/input boundary: PASS**
- **EventMind V11 runtime safety code: PASS once exact final branch CI is recorded**
- **Fresh V11 model gate: PREPARED / NOT RUN ON LOCAL GPU**
- **Production EventMind: BLOCKED**

Important: a synthetic 90-case PASS proves the new runtime/representation gate is healthy; it must not be overstated as complete real-mailbox generalization proof.

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF;
- source archive OFF;
- Mailgun source persistence OFF;
- EventMind V11 runtime OFF;
- no live migration applied from this flow;
- no provider cutover;
- no AI identity authority;
- no Purchase/Shipment/Document/Identity production authority change.

## NEXT ACTION

1. Keep PR #295 draft and all live/source/AI flags OFF.
2. Run `scripts/BuyFlow-EVENTMIND-V11-GATE.cmd` on the user's Windows/WSL machine where the real V11 adapter and GPU exist.
3. Preserve the first PASS/FAIL result unchanged; do not train on that fixture.
4. Review that result before any EventMind enablement.
5. If EventMind evidence is clean, continue the module audit with **TrustLink**.
6. MailGate/RawVault production smokes are still required before source cutover.
7. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
