# BuyFlow worklog latest

## 2026-09-02 — TrustLink zero-trust audit PASS

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

TrustLink correlation, graph mutation rules and future promotion readiness were reviewed end-to-end.

Existing safe behavior confirmed:
- exact identity keys are scoped by user + namespace + stable identifier;
- unscoped discovery is review-only;
- multiple hard candidates -> REVIEW;
- hard extraction conflict -> PENDING;
- lifecycle-only messages cannot create Purchase;
- Purchase creation requires deterministic root authority;
- REVIEW/PENDING/UNLINKED do not mutate the graph;
- current orchestration remains shadow-only with `productionWrites: 0`.

One real promotion-safety gap was found: the visible email `From:` / sender domain could previously be strong enough to establish merchant scope for a future write-ready hard order link, even though `From:` can be spoofed. Raw `Authentication-Results` is already diagnostic-only in MailLens and is not a trustworthy source by itself.

Remediation:
- merchant-scoped CREATE_PURCHASE and merchant-scoped hard order/parent-child/invoice promotion now require explicit trusted sender authority provenance;
- accepted authority must be `field=sender_authority`, `source=provider_adapter`, qualifier `trusted_sender_authority`;
- raw/header provenance cannot satisfy the gate;
- current real source adapters do not yet emit this trusted marker, so merchant-scoped production promotion remains fail-closed by default.

Tests added for trusted/untrusted merchant creation and links, fake header-origin authority, and carrier-scoped tracking independence.

First verification CI #1168 / run `33648039402` failed one old lifecycle-chain test because its synthetic safe-merchant fixtures did not declare the new trusted authority. The safety rule was kept unchanged; the synthetic gate was updated to explicitly model provider-authenticated safe merchant senders.

Final verified code head:
`dcbd2e5a95b00d1b7c67ce845329d9b8164cc8ba`

Final GitHub Actions CI #1169 / run `33648405215`: **PASS**.
- EventMind Python runtime syntax PASS;
- EventMind PowerShell launcher syntax PASS;
- API typecheck PASS;
- API tests PASS;
- API build PASS;
- mobile typecheck PASS;
- mobile web build PASS.

Verdict:
- **TrustLink code / zero-trust audit: PASS**;
- sender-authority gap: **REMEDIATED**;
- production writes remain **OFF/BLOCKED**;
- real provider-authentication provenance still needs a separate trusted source-adapter implementation before merchant promotion can ever be enabled.

Protocol: `protocols/TRUSTLINK-AUDIT-2026-09-02.md`.

Next module audit: **JourneyGraph**.

---

## 2026-09-02 — EventMind V11 fresh local GPU gate PASS

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

The first untouched local GPU run of the new MailLens/EventMind V11 representation gate completed successfully.

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

Next module audit: **TrustLink**.

---

## 2026-09-02 — EventMind V11 runtime + fresh gate prepared and CI GREEN

After the EventMind MailLens/identity boundary passed, the actual V11 runtime path was hardened.

Implemented:
- `apps/api/src/ai/eventmind-v11-runtime.ts` as a fail-closed API-side V11 client;
- `scripts/eventmind-v11-runtime.py` as a loopback-only local Qwen3-8B/V11 server;
- exact adapter SHA-256 pinning and runtime metadata checks;
- explicit thinking OFF with no silent tokenizer fallback;
- deterministic generation (`do_sample=false`, max 48 new tokens);
- V11 training completion + holdout-isolation checks before model load;
- timeout through full response parsing;
- unavailable/OOM/timeout/HTTP/malformed/metadata mismatch/invalid output -> no semantic result;
- no Purchase identity authority added anywhere.

Production EventMind remains OFF and the normalized inbound source lane is still not automatically calling Qwen.

Fresh representation/runtime gate prepared:
- `apps/api/src/ai/eventmind-v11-representation-gate.ts`;
- `apps/api/src/scripts/eventmind-v11-representation-gate.ts`;
- `apps/api/src/scripts/eventmind-v11-untouched-fixture-v1.ts`;
- `scripts/run-eventmind-v11-gate.ps1`;
- `scripts/BuyFlow-EVENTMIND-V11-GATE.cmd`.

The new local fixture contains 90 synthetic cases: 5 for each of the fixed 18 events. It includes multilingual cases, stale snippet/subject traps, quoted old lifecycle history and structured lifecycle/identity noise. It is first-use-only and stored under Git-ignored `local-data/`.

The already-viewed 180-case fixture is explicitly rejected by SHA-256:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`.

Before first inference the runner hashes and freezes the exact fixture, writes a `FROZEN_BEFORE_INFERENCE` manifest and refuses silent reuse of a locally consumed fixture hash.

Gate PASS rules:
- >=90 cases and all 18 labels;
- invalid output = 0;
- incoherent output = 0;
- unsafe lifecycle promotion = 0;
- OTHER -> commerce FP = 0;
- exact >=90%;
- macro event >=85%.

Final exact branch verification before local gate:
`af99492f4e852250b5a8fb05f1167336dd50c419`

Temporary CI-only PR #304 / GitHub Actions CI #1167 / run `33635810471` passed Python/PowerShell syntax, API typecheck/tests/build, and mobile typecheck/build. PR #304 was closed unmerged.

---

## 2026-09-02 — EventMind MailLens / identity boundary remediated

Added `apps/api/src/ai/eventmind-v1.ts` as the single production-side semantic input/decoder contract. EventMind consumes MailLens `semanticText`, uses a locked 18-event taxonomy, rejects every extra model output field and maps only into a semantic-only override. Internal Purchase candidates/ids do not enter the model contract and AI cannot create/link/merge/select Purchase identity.

Initial boundary behavior head:
`1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`

Temporary CI-only PR #303 / CI #1152 / run `33632992124`: API typecheck/tests/build + mobile typecheck/build PASS. PR #303 closed unmerged.

---

## 2026-09-02 — MailLens remediation complete

MailLens `normalized-email-document-v1.1` became the single provider-neutral semantic normalization boundary with bounded full `bodyText`, separate current `semanticText`, quoted-history/hidden-content controls, attachment protection and diagnostic-only header authentication.

Behavior head:
`f69195404831323f2783464a61f6f7b7435698b5`.

CI #1151 / run `33631564933`: API typecheck/tests/build + mobile typecheck/build PASS. Production source path remains BLOCKED pending MailGate + RawVault staging/live gates.

---

## 2026-09-02 — RawVault remediation complete

Immutable source archive, SHA-256/opaque keys, durable pre-write manifest, explicit retention, crash/orphan/account-deletion cleanup, raw-hash conflict detection and DB immutability added.

Behavior head:
`9480e6d4e8d5c3e0a771b43671503cda593971c2`.

Production RawVault remains BLOCKED pending controlled staging migration + retention/storage smoke.

---

## 2026-09-02 — MailGate remediation complete

Direct Gmail source code hardened for complete initial snapshot/cursor behavior, detached body hydration, safe timestamps, bounded retry/concurrency, expired-history recovery, watch renewal/fallback sync and strict OAuth authority.

Behavior head:
`e67b908e07d072e3737611eca4ee804d7d905c26`

Production MailGate remains BLOCKED pending controlled real-Gmail read-only shadow smoke.
