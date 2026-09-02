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

Immutable raw/normalized archive, SHA-256/opaque keys, durable pre-write manifest, explicit retention, crash/orphan/account-deletion cleanup, raw-hash conflict detection and DB immutability added.

Production RawVault: **BLOCKED** pending controlled staging migration + explicit retention policy + real private-storage cleanup smoke.

Behavior head: `9480e6d4e8d5c3e0a771b43671503cda593971c2`.

## MAILLENS

Code remediation: **PASS**.

MailLens `normalized-email-document-v1.1` is the single provider-neutral semantic normalization boundary with bounded full `bodyText`, separate current `semanticText`, quoted-history/hidden-content controls, attachment protection and diagnostic-only header authentication.

Behavior head: `f69195404831323f2783464a61f6f7b7435698b5`.

CI #1151 / run `33631564933`: API typecheck/tests/build + mobile typecheck/build PASS. Production source path remains BLOCKED pending MailGate + RawVault staging/live gates.

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

### V11 runtime safety — PASS, STILL OFF

Added a pinned local V11 runtime:
- `apps/api/src/ai/eventmind-v11-runtime.ts`
- `scripts/eventmind-v11-runtime.py`

Safety behavior:
- EventMind runtime flag defaults OFF;
- exact adapter SHA-256 required when enabled;
- model must report `Qwen/Qwen3-8B`;
- runtime/template versions must match;
- thinking must be explicitly OFF; no silent tokenizer fallback;
- deterministic generation (`do_sample=false`, max 48 new tokens);
- V11 training completion + holdout-isolation checks before model load;
- timeout through full response parsing;
- unavailable/OOM/timeout/HTTP/malformed/metadata mismatch/invalid output -> no semantic result;
- no Purchase identity authority added anywhere.

Final exact branch verification before local gate:
`af99492f4e852250b5a8fb05f1167336dd50c419`

Temporary CI-only PR #304 / GitHub Actions CI #1167 / run `33635810471` passed Python/PowerShell syntax, API typecheck/tests/build, and mobile typecheck/build. PR #304 was closed unmerged.

### Fresh MailLens/EventMind V11 gate — PASS

First untouched local GPU inference completed on 2026-09-02.

Frozen fixture:
- 90 cases;
- all 18 fixed EventMind labels represented;
- fixture SHA-256: `4d70c774b332edbc7aabe19d754f51ac2e47762c3d17cc018f25d4786d91fd0e`.

Pinned real V11 adapter SHA-256:
`462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`

First preserved result:
- Exact: **90/90 (100.00%)**;
- Macro event: **100.00%**;
- Invalid: **0**;
- Unsafe promotions: **0**;
- Gate: **PASS**.

Local result directory:
`local-data/eventmind-v11-representation-gate/runs/20260902T150955Z`

The fixture must never be used for training after this evaluation.

Interpretation:
- EventMind MailLens/input/identity boundary: **PASS**;
- V11 runtime safety: **PASS**;
- fresh V11 representation/runtime gate: **PASS**;
- production EventMind remains **OFF/BLOCKED** because this synthetic gate is not full real-mailbox generalization proof and upstream MailGate/RawVault production smokes are still pending.

Protocol: `protocols/EVENTMIND-AUDIT-2026-09-02.md`.

## TRUSTLINK

Code / zero-trust audit: **PASS**.

Existing deterministic safety was confirmed: identity keys are user+namespace scoped, unscoped matches are review-only, multiple hard candidates become REVIEW, hard extraction conflicts become PENDING, lifecycle-only messages cannot create Purchase, and current graph orchestration stays shadow-only with `productionWrites: 0`.

One real gap was found and fixed: the visible email `From:` / sender domain was too strong for future merchant-scoped promotion even though it can be spoofed.

Merchant-scoped CREATE_PURCHASE and hard order/parent-child/invoice-via-merchant promotion now require explicit trusted sender authority provenance:
- `field=sender_authority`
- `source=provider_adapter`
- qualifier `trusted_sender_authority`

Raw/header-origin authentication cannot satisfy the gate. Current real source adapters do not yet emit this trusted authority marker, therefore merchant-scoped production promotion remains **BLOCKED by default**.

First CI #1168 intentionally exposed an old synthetic lifecycle fixture that lacked the new trusted authority. The safety rule was not weakened; the synthetic safe-merchant fixture was corrected.

Final verified TrustLink code head:
`dcbd2e5a95b00d1b7c67ce845329d9b8164cc8ba`

GitHub Actions CI #1169 / run `33648405215`: Python/PowerShell syntax, API typecheck/tests/build and mobile typecheck/build all **PASS**.

Protocol: `protocols/TRUSTLINK-AUDIT-2026-09-02.md`.

Current status:
- **TrustLink deterministic correlation: PASS**
- **Sender-authority gap: REMEDIATED**
- **Production TrustLink writes: OFF / BLOCKED**
- **Real trusted provider-authentication provenance: NOT WIRED YET**

## JOURNEYGRAPH

Code / state audit: **PASS**.

Real issues found and fixed:
- a multi-parcel Purchase could become `delivered` after only one Shipment was delivered;
- whole-Purchase `delivered_at` could reflect the first parcel instead of final parcel completion;
- stale order/delay mail could downgrade `ready_for_pickup`;
- proven physical Shipment progress could leave stale `payment_failed` / `delayed` as the visible journey state;
- controlled post-write verification still assumed one parcel and could falsely report failure after a correct database update.

Current behavior:
- all linked Shipments are reduced together;
- Purchase is `delivered` only when **every** Shipment is delivered;
- final Purchase delivery time is the **latest** parcel delivery time;
- an outstanding in-transit parcel keeps the Purchase `in_transit`;
- otherwise an outstanding pickup parcel keeps it `ready_for_pickup`;
- unknown legacy outstanding Shipment state never validates a false whole-Purchase completion;
- physical parcel progress outranks stale non-terminal order/payment/delay journey state;
- cancelled/refunded/returned remain protected terminal states;
- controlled Shipment replays are monotonic and pre-advice (`shipment_created`) remains blocked from the physical write lane.

The carrier bridge uses the same controlled shipment RPC, and the Foxpost repair path updates source evidence only, so no separate Purchase-state bypass was found.

Final verified JourneyGraph code head:
`8ef8d36bb9f0ee7ebce3477c13e30f510df30e4f`

GitHub Actions CI #1183 / run `33651035053`: EventMind syntax checks + API typecheck/tests/build + mobile typecheck/build all **PASS**.

Prepared migration:
`supabase/migrations/20260902153000_fix_journeygraph_multishipment_aggregate.sql`

The migration was **NOT applied** to staging or production. Production JourneyGraph DB remediation remains **BLOCKED** pending controlled staging migration + multi-shipment smoke.

Temporary verification PR #306 was closed unmerged.

Protocol: `protocols/JOURNEYGRAPH-AUDIT-2026-09-02.md`.

Current status:
- **JourneyGraph code/state semantics: PASS**
- **Multi-shipment safety: PASS**
- **Production DB migration: NOT APPLIED / BLOCKED**

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF;
- source archive OFF;
- Mailgun source persistence OFF;
- EventMind V11 runtime OFF;
- TrustLink production writes OFF;
- JourneyGraph migration NOT APPLIED;
- no live migration applied from this flow;
- no provider cutover;
- no AI identity authority;
- no Purchase/Shipment/Document/Identity production authority change.

## NEXT ACTION

1. Preserve the EventMind first gate result unchanged and never train on that fixture.
2. Keep PR #295 draft and all live/source/AI/write flags OFF.
3. Continue the module audit with **DocVault**.
4. MailGate/RawVault production smokes are still required before source cutover.
5. Trusted provider-authentication provenance must be implemented and separately verified before merchant-scoped TrustLink promotion can be enabled.
6. JourneyGraph migration must first pass controlled staging + multi-shipment smoke before any production application.
7. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
