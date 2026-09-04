# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then the newest worklog/protocol entries. Reconcile with live GitHub/Supabase state before changing runtime code.

**Last updated:** 2026-09-04 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Source/audit branch:** `codex/modern-email-source-foundation-v1`  
**EventMind development branch:** `codex/buyflow-testlab-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI classifies commerce/lifecycle semantics only; it never grants Purchase identity.
- Purchase Identity Graph v2 is the only identity/link/create/merge authority.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime, source archive, EventMind production runtime and TrustLink production writes remain OFF.
- Legacy automatic Purchase creation/payment Core writes remain OFF/fail-closed.
- No production provider cutover or production migration was performed by this audit/smoke flow.
- V11 remains the reference adapter; V12 is not promoted.
- Real Gmail model development must not change production flags or write to Gmail/BuyFlow production.
- Raw/private Gmail contents and raw Gmail IDs must not be committed to Git. Sanitized hashes/metrics are allowed.

## 9-MODULE CODE AUDIT — COMPLETE

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

### MailGate — PASS / real Gmail RAW + history gate PASS / production runtime OFF
- Code remediation head: `e67b908e07d072e3737611eca4ee804d7d905c26`; CI #1142 PASS.
- 2026-09-02 first real Gmail read-only smoke: six bounded recent commerce/lifecycle messages, exact RAW MIME **6/6**, observed normal body parity PASS, Gmail mutation safety PASS.
- A sampled UNREAD message remained UNREAD after RAW inspection.
- Since that smoke start: **0 source emails, 0 Purchase updates, 0 Shipment updates, 0 Documents, 0 AI runs** in production.
- No detached renderable text body happened to occur in that six-message live slice; detached-body hydration remains regression-covered, not claimed as live evidence.
- 2026-09-02 real Gmail cursor/history smoke using the already-authorized local n8n Gmail OAuth credential: RAW MIME **6/6**, real Gmail `historyId` capture **PASS**, real `users.history.list` replay **PASS**, observed history records **0**, mailbox writes **0**, BuyFlow DB writes **0**, AI calls **0**, overall **GATE PASS**.
- Zero history records are valid: the gate proves successful authenticated replay from a real Gmail `historyId`; it does not require manufacturing a mailbox mutation.
- Verified local n8n profile: `C:\Users\kozma\Desktop\buyflow\.n8n-local-ai-data`, n8n `2.37.3`.
- Direct Gmail production runtime remains OFF; no durable cursor/checkpoint or production source/archive/domain write was committed by the smoke.
- Protocols: `protocols/MAILGATE-REAL-GMAIL-SHADOW-SMOKE-2026-09-02.md`, `protocols/MAILGATE-DIRECT-GMAIL-AUDIT-REMEDIATION-2026-09-02.md`, `protocols/MAILGATE-HISTORY-SMOKE-2026-09-02.md`.

### RawVault — code PASS / storage-retention smoke still required
- Immutable raw/normalized archive, SHA-256/opaque keys, durable manifest, retention/crash/orphan/account-deletion cleanup and DB immutability implemented.
- Behavior head: `9480e6d4e8d5c3e0a771b43671503cda593971c2`.
- Production source archive remains OFF.
- Remaining: controlled private-storage + independent retention + stale pending orphan + source/user/account deletion cleanup smoke against real Supabase Storage objects.
- The inactive `BuyFlow-Smoke-Test` cannot be restored while production + actively-used old staging occupy the Free-plan active-project slots.
- A Supabase development branch was considered; quoted cost was **$0.01344/hour** and explicitly approved, but branch creation was rejected because branching requires Pro or higher. No paid branch was created and no branch charge is running.
- Do not pause the actively-used old staging merely to force this test, and do not fake real Storage behavior by writing directly to `storage.objects`.

### MailLens — PASS
- `normalized-email-document-v1.1` is the provider-neutral normalization boundary.
- Full bounded `bodyText` and current-only `semanticText` are separate; quoted/hidden content controlled; attachments cannot inject authored body; header auth diagnostic-only.
- Head `f69195404831323f2783464a61f6f7b7435698b5`; CI #1151 PASS.

### EventMind — code audit PASS / REAL GMAIL QUALITY GATE OPEN / production OFF
- Fixed 18-event taxonomy; strict output exactly `is_commerce` + `event_type`; identity-bearing output invalidates response.
- V11 runtime fail-closed, deterministic, thinking OFF, exact adapter/runtime metadata pinned.
- Curated first untouched 90-case local GPU gate was **90/90 exact**, but this did **not** predict performance on the later real Gmail set.
- Fixture SHA `4d70c774b332edbc7aabe19d754f51ac2e47762c3d17cc018f25d4786d91fd0e`; adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`.
- Never train on that 90-case fixture.
- EventMind production runtime remains OFF.

## EVENTMIND REAL120 — FROZEN REAL GMAIL DEVELOPMENT SET

Frozen 120 Gmail message-ID pool was selected by Gmail search IDs only before opening contents and excluded the known Batch19 IDs. Canonical newline-joined ID SHA:

`88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470`

Do not claim the contents were inspected before the prediction freeze.

### V11 baseline run — valid but poor real-world baseline
- GitHub TestLab run #7: run `33676590636`, job `100402725296`, head `5b8926cc75afb407004506e07328ffc3ec5cc939`, result FAILED.
- All 120 message attempts ran; **84 valid / 120**, **36 errors**.
- Failure breakdown: 30 `INVALID_MODEL_OUTPUT/INVALID_VALUES`, 1 `INVALID_MODEL_OUTPUT/COMMERCE_INVARIANT_MISMATCH`, 3 `RUNTIME_TIMEOUT`, 2 `RUNTIME_HTTP_ERROR/503`.
- Mailbox writes 0; BuyFlow DB writes 0.
- **84/120 = 70% is valid-output rate, not accuracy.**

After predictions were frozen, the 120 messages were read-only inspected and human ground truth was assigned. This is valid for measuring the V11 baseline, but from that point onward REAL120 is no longer a fresh holdout for new prompt/model candidates.

Sanitized measured V11 REAL120 score:
- exact event matches: **41/120 = 34.17% strict exact**;
- accuracy among valid outputs: **48.81%**;
- buyer-commerce exact: **38/76 = 50.0%** strict;
- buyer-commerce accuracy among valid outputs: **62.3%**;
- OTHER exact: **3/44 = 6.82%**;
- strong classes included DELIVERED 4/4, INVOICE 2/2, ORDER_PACKING 4/4, ORDER_PROCESSING 4/4, OUT_FOR_DELIVERY 10/11;
- weak classes included SHIPPED 0/12 and READY_FOR_PICKUP 0/3;
- major systematic error: merchant/outbound Express One pickup operations were often interpreted as buyer purchases instead of OTHER.

**Science rule:** V13/V13-lite on REAL120 is a development comparison only. Final unbiased validation requires a new untouched holdout after the candidate is frozen.

## V13 / V13-LITE DEVELOPMENT

The first V13 candidate reused the same Qwen3-8B V11 adapter/runtime but had a longer buyer-lifecycle prompt. It was not a newly trained adapter.

### V13 TestLab attempts — not preferred anymore for local GPU model tests
- Run #8 (`33681610060`) failed after a runtime timeout cascade; the >1h delay eventually caused Gmail OAuth access-token expiry and later Gmail 401s. Predictions OK 43/120, errors 77, technical retries 76.
- Run #9 (`33775107330`) also failed; user reported this newer TestLab/self-hosted-runner method freezes the PC.
- User explicitly prefers the old direct local pattern for EventMind GPU tests: **one CMD -> local n8n Gmail OAuth -> local Qwen -> report on Desktop**.
- Do not switch EventMind model tests back to GitHub TestLab/self-hosted runner unless the user explicitly changes this preference.

### V13-lite candidate
- V13-lite keeps the same V11 adapter/runtime and shortens the prompt to only REAL120-proven distinctions: merchant/outbound courier collection -> OTHER, SHIPPED vs SHIPMENT_CREATED, READY_FOR_PICKUP vs DELIVERED.
- Current development branch: `codex/buyflow-testlab-v1`.
- Memory-safe prompt revision adds `EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS = 12000` only at the V13-lite model-input layer; MailLens itself is not globally reduced.
- Relevant commits in this diagnostic sequence: `f1b3524c14234294e116717c55dd9028bd28fe79` (12k V13-lite cap), `c2e9b0f3211ed4029d9104db29dbea24476def97` (cap regression test), followed by chunk/final-judge diagnostic work through branch head `17c66e2bb61e17c46e6a12ca9f97dd971b084ab9` at the time of this handoff update.

## PC FREEZE / MEMORY DIAGNOSTIC — ROOT EVIDENCE

Direct V9 reached real Gmail/model execution and showed the PC freezing around the first timeout. Do not interpret this as proof the machine is generally too weak.

### Repro on REAL120 #43–47 before memory-safe cap
Targeted REAL5 diagnostic on indices 43–47 produced:
- #43 `ORDER_PACKING`, 6791 ms, RAM ~75.3 -> 75.4%;
- #44 `ORDER_CREATED`, 2966 ms, RAM ~75.4 -> 75.4%;
- #45 `RUNTIME_TIMEOUT`, 20214 ms, CPU 63.6%, RAM **75.4 -> 99.1%**, free system RAM **~8.42 GB -> ~323 MB**.

This explains the Windows stutter/freeze: the system memory almost exhausted during the #45 inference.

Important correction: later chunk diagnostics showed #45's normalized `semanticText` is only **7120 characters** and structured data JSON is essentially empty (2 chars). Therefore the earlier hypothesis that #45 was a ~100k-character email was wrong. The problem is a prompt/runtime/attention behavior triggered by this case, not simply an enormous source email.

AMD/ROCm runtime logs also emitted warnings that flash-efficient and memory-efficient attention on the current AMD GPU are experimental. Treat this as relevant runtime context, not as proven sole root cause.

### Memory-safe retest after 12k V13-lite cap
Same REAL5 target after the V13-lite 12k model-input cap:
- #43 OK `ORDER_PACKING`;
- #44 OK `ORDER_CREATED`;
- #45 no longer froze memory; it returned `RUNTIME_HTTP_ERROR HTTP 503` in 7226 ms;
- #45 RAM stayed **74.9 -> 75.1%**, free RAM remained ~8.5 GB;
- #46 OK `ORDER_PROCESSING` in 13246 ms;
- #47 OK `ORDER_PACKING` in 3281 ms;
- no early timeout.

Interpretation:
- system-RAM freeze behavior is mitigated by the memory-safe candidate path;
- #45 still has a runtime/GPU-side failure (503) in whole-email mode;
- do not claim full root cause is solved yet.

## CHUNKING DIAGNOSTIC — REAL120 #45

Goal: avoid throwing away the end of long/problematic messages and reduce per-inference memory pressure. This is experimental only; no production aggregation is enabled.

Chunk diagnostic settings:
- source semantic text: **7120 chars**;
- chunk max: **3000 chars**;
- overlap: **250 chars**;
- chunks planned: **3**;
- source fully covered: **true**;
- production flags OFF, Gmail GET-only, no final event aggregation performed.

Results:
- chunk 1: `SHIPPED`, prompt 5698 chars, 10432 ms, RAM 80.6 -> 80.4%;
- chunk 2: `SHIPPED`, prompt 5610 chars, 6011 ms, RAM 79.8 -> 79.8%;
- chunk 3: `INVALID_MODEL_OUTPUT / COMMERCE_INVARIANT_MISMATCH`, prompt 3994 chars, 4056 ms, RAM 79.9 -> 80.9%;
- no runtime timeout; system memory remained stable compared with the earlier 99.1% spike.

Interpretation:
- **chunking stability/memory behavior: promising / PASS for this one problematic case**;
- **naive majority aggregation is NOT acceptable**: human ground truth for REAL120 #45 is `OUT_FOR_DELIVERY`, while the two valid chunks both returned `SHIPPED`;
- therefore chunk-level labels must not simply vote for the final event.

## CURRENT EXPERIMENT — CHUNK45 FINAL JUDGE

A new experimental direct diagnostic was prepared:

**flow:** full normalized email -> 3 bounded chunks -> chunk classifications + short lifecycle evidence -> small final-judge Qwen call -> one final event.

Constraints:
- final judge does **not** receive the whole email again;
- only short evidence + chunk outputs are sent;
- no identity authority;
- Gmail GET-only;
- BuyFlow production writes 0;
- no production flags enabled;
- report must not persist raw Gmail IDs or message content.

Current files/commits:
- chunk diagnostic TS: `apps/api/src/scripts/eventmind-v13-real-gmail-chunk45-diagnostic.ts`, introduced in commit `0792a897e92e48fb10102647a7ba90e4cde4bcab`;
- direct chunk launcher script: `scripts/run-eventmind-v13-lite-chunk45-diagnostic-direct.ps1`, commit `bf400677e1a28427336d57f476b3045970541699`;
- final-judge experiment code introduced in commit `14895b19ad03b3b0096262b57bbbc14b23ac8766`;
- one-click final-judge direct launcher prepared at commit `17c66e2bb61e17c46e6a12ca9f97dd971b084ab9`.

**Status at handoff update:** final-judge launcher has been prepared but its real #45 output has **not yet been provided/verified**. Do not claim it returns `OUT_FOR_DELIVERY` until actual output is shown.

## TrustLink — PASS / trusted Gmail provider-auth code PASS / production writes OFF
- Zero-trust identity/linking: scoped hard keys, ambiguity -> REVIEW, hard conflict -> PENDING, lifecycle-only no-create.
- Merchant-scoped promotion requires explicit trusted `provider_adapter` sender authority; visible From/header auth alone cannot grant authority.
- Gmail provider-auth adapter emits `trusted_sender_authority` only when source provider is Gmail, first `Authentication-Results` authserv-id is exactly `mx.google.com`, DMARC passes, and authenticated `header.from` exactly matches normalized visible sender domain.
- Exact verified provider-auth head `2424d1d19bd975b7d2905f47352520abab93c50d`; CI #1188 / run `33666543307` PASS; verification PR #310 closed unmerged.
- Protocol: `protocols/TRUSTLINK-PROVIDER-AUTH-2026-09-02.md`.
- TrustLink production writes remain OFF until a separate explicit production cutover decision.

### JourneyGraph — PASS / isolated DB smoke PASS
- Head `8ef8d36bb9f0ee7ebce3477c13e30f510df30e4f`; CI #1183 PASS.
- Production migration NOT APPLIED.

### DocVault — PASS / isolated DB smoke PASS
- Head `e77a226f403c6d5141e91d32d277bc99ce91ac21`; CI #1184 PASS.
- Production migrations NOT APPLIED.

### Core — PASS / isolated DB smoke PASS / legacy writes OFF
- Head `326b6481fc74c9f367a841f334ecd22928030012`; CI #1185 PASS.
- Production migration NOT APPLIED.

### Pulse — PASS
- Read-only Purchase status/next-action projection; no push engine or production write authority added.
- Head `df75e04989afd89df080942adcf31cb4ee4ec2d4`; CI #1187 PASS.

## CONTROLLED DATABASE SMOKE — PASS

Protocol: `protocols/STAGING-SMOKE-2026-09-02.md`.

The old `BuyFlow-Staging` project is on a stale/incompatible schema lineage and was not migrated. A separate synthetic `BuyFlow-Smoke-Test` project reproduced the production-required baseline and exercised JourneyGraph -> DocVault bridge -> DocVault -> Core migrations.

Results: all target migrations PASS; production read-only preflight found 9 documents, 0 orphan documents, 0 conflicting invoice-hash groups, 1 multi-shipment Purchase and 0 inconsistent multi-shipment aggregate states.

Cleanup: `BuyFlow-Smoke-Test` INACTIVE; original `BuyFlow-Staging` restored ACTIVE_HEALTHY; production `buyflow-v3` untouched.

## DEPLOYMENT STATE

Still OFF / conservative:
- direct Gmail runtime OFF;
- Direct Gmail runtime-state migration NOT APPLIED production;
- source archive OFF;
- EventMind production runtime OFF;
- TrustLink production writes OFF;
- legacy automatic Purchase/payment writes OFF;
- JourneyGraph/DocVault/Core production migrations NOT APPLIED;
- no provider cutover;
- no AI identity authority;
- no production Purchase/Shipment/Document/Identity authority change.

## FINAL PRE-PRODUCTION READINESS

**Code/audit PASS:** MailGate, MailLens, EventMind contract/runtime safety, TrustLink, JourneyGraph, DocVault, Core, Pulse.  
**EventMind real-world semantic quality:** **OPEN / not production-ready**. REAL120 V11 baseline was poor; V13-lite/chunk/final-judge development is ongoing.  
**RawVault:** code/audit PASS, but real private Supabase Storage + retention/orphan/account-deletion cleanup smoke remains environment-blocked.  
**Production:** unchanged and OFF.

Therefore RawVault is no longer described as the only unresolved pre-production gate: EventMind also needs a frozen candidate + fresh untouched real-mail holdout before production readiness.

## NEXT ACTIONS

1. Run/inspect the prepared **CHUNK45 + FINAL JUDGE** direct diagnostic on REAL120 #45. Do not claim success before actual output.
2. If #45 returns the human-truth `OUT_FOR_DELIVERY` with stable memory, test the same chunk+judge method on a small diverse REAL120 development slice containing SHIPPED, READY_FOR_PICKUP, OUT_FOR_DELIVERY, OTHER and known invalid/runtime cases.
3. Freeze the candidate only after development behavior is acceptable.
4. Create a **new fresh untouched holdout** for final unbiased EventMind validation. REAL120 cannot be reused as the final holdout because its ground truth is now known.
5. Keep EventMind tests on the user's preferred **old DIRECT local CMD** method; no TestLab/self-hosted runner for GPU model tests unless explicitly requested.
6. RawVault controlled real Storage smoke still remains required when a safe isolated Storage-capable environment is available.
7. After both EventMind fresh-holdout quality gate and RawVault Storage gate pass, perform final production cutover review.
8. Production migrations, Direct Gmail runtime, source archive, EventMind runtime and TrustLink writes remain OFF until a separate explicit cutover decision.
9. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból. A 9 modulos code audit kész, de EventMind real-world quality gate még nyitott. REAL120 V11 baseline: 41/120 strict exact (34.17%); REAL120 már development set, nem friss holdout. A problémás #45 levél whole-email futása korábban RAM 75.4% -> 99.1% + timeoutot okozott; V13-lite 12k memory-safe cap után a RAM stabil lett (~75%), de #45 HTTP 503 maradt. Chunk45 teszt: 7120 karakteres semanticText -> 3x ~3000 karakter, stabil memória/no timeout; chunk eredmények SHIPPED, SHIPPED, invalid, miközben human truth OUT_FOR_DELIVERY, ezért naiv voting tilos. Következő kísérlet: CHUNK45 + short-evidence FINAL JUDGE direct launcher, commit/head 17c66e2bb61e17c46e6a12ca9f97dd971b084ab9; eredménye még nincs igazolva. EventMind GPU tesztekhez a user a régi DIRECT CMD módszert kéri, nem TestLabot. RawVault valódi private Supabase Storage smoke továbbra is környezeti okból BLOCKED. Production továbbra is OFF és érintetlen.**
