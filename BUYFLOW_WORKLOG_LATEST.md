# BuyFlow worklog latest

## 2026-09-02 — EventMind V11 runtime + fresh gate prepared

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

After the EventMind MailLens/identity boundary passed, the next blocker was the actual V11 runtime path.

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

One-click user action prepared:
`scripts/BuyFlow-EVENTMIND-V11-GATE.cmd`

It creates the fixture, starts the real local V11 adapter in WSL, verifies actual adapter SHA + Qwen3-8B + thinking OFF + deterministic mode, runs the 90-case gate, prints PASS/FAIL and stops the model server. It does not train the model and does not enable production EventMind.

Runtime safety behavior head before documentation commits:
`a3539e08927b9d6013c0b15ff6b4222df8c26211`

Temporary CI-only PR: #304. Final exact-head CI result must be recorded after documentation is complete; then close #304 unmerged.

Current verdict:
- **EventMind MailLens/identity boundary: PASS**
- **V11 runtime safety code: implemented; final exact-head CI record pending**
- **Fresh V11 representation gate: PREPARED / NOT RUN ON LOCAL GPU**
- **Production EventMind: BLOCKED**

Important: a synthetic 90-case PASS is runtime/representation evidence, not complete real-mailbox generalization proof.

Next: run the one-click local V11 gate and preserve its first result unchanged. Do not train on the fixture. If the EventMind evidence is clean, continue with **TrustLink**.

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
`f69195404831323f2783464a61f6f7b7435698b5`

CI #1151 / run `33631564933`: API typecheck/tests/build + mobile typecheck/build PASS. Production source path remains BLOCKED pending MailGate + RawVault staging/live gates.

---

## 2026-09-02 — RawVault remediation complete

Immutable source archive, SHA-256/opaque keys, durable pre-write manifest, explicit retention, crash/orphan/account-deletion cleanup, raw-hash conflict detection and DB immutability added.

Behavior head:
`9480e6d4e8d5c3e0a771b43671503cda593971c2`

Production RawVault remains BLOCKED pending controlled staging migration + retention/storage smoke.

---

## 2026-09-02 — MailGate remediation complete

Direct Gmail source code hardened for complete initial snapshot/cursor behavior, detached body hydration, safe timestamps, bounded retry/concurrency, expired-history recovery, watch renewal/fallback sync and strict OAuth authority.

Behavior head:
`e67b908e07d072e3737611eca4ee804d7d905c26`

Production MailGate remains BLOCKED pending controlled real-Gmail read-only shadow smoke.
