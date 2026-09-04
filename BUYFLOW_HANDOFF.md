# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_TECHNICAL_CONTINUITY.md`, then the newest protocol/worklog relevant to the active module. Reconcile with live GitHub/Supabase state before changing runtime code.

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
- JourneyGraph/DocVault/Core target production migrations remain NOT APPLIED.
- No provider cutover and no AI identity authority.
- V11 remains the reference adapter; V12 is not promoted.
- Real Gmail model development must stay read-only and must not change production flags.
- Raw/private Gmail contents and raw Gmail IDs must not be committed to Git.

## 9-MODULE STATE

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

- **MailGate:** code PASS; real Gmail RAW + `historyId/history.list` gate PASS; Direct Gmail production OFF.
- **RawVault:** code/audit PASS; real private Supabase Storage + retention/orphan/account-deletion smoke still unresolved because of environment limits.
- **MailLens:** PASS.
- **EventMind:** code/runtime-safety audit PASS; **real-world semantic quality gate OPEN**; production OFF.
- **TrustLink:** PASS incl. Gmail provider-auth; production writes OFF.
- **JourneyGraph:** PASS; isolated DB smoke PASS; production migration not applied.
- **DocVault:** PASS; isolated DB smoke PASS; production migrations not applied.
- **Core:** PASS; isolated DB smoke PASS; legacy writes OFF; production migration not applied.
- **Pulse:** PASS/read-only.

## EVENTMIND REAL120 — DEVELOPMENT SET

Frozen 120 Gmail message-ID pool SHA256:

`88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470`

The pool was selected before contents were inspected. After the V11 prediction freeze, human ground truth was assigned read-only. Therefore REAL120 was a valid blind baseline for V11, but is now a **development set** for V13/V13-lite and cannot serve as the final unbiased holdout.

V11 measured baseline:
- valid outputs: 84/120
- errors: 36
- strict exact event accuracy: **41/120 = 34.17%**
- accuracy among valid outputs: **48.81%**
- buyer-commerce strict exact: **38/76 = 50.0%**
- OTHER strict exact: **3/44 = 6.82%**
- major weaknesses: merchant/outbound courier pickup -> buyer lifecycle confusion, SHIPPED, READY_FOR_PICKUP.

Final production-quality proof must use a **new untouched holdout** after the candidate design is frozen.

## EVENTMIND TEST METHOD — USER PREFERENCE

For local GPU/EventMind tests use the old direct pattern:

`one CMD -> local n8n Gmail OAuth -> local Qwen -> real Gmail GET-only -> Desktop report`

Do **not** default back to GitHub TestLab/self-hosted runner for EventMind GPU tests unless the user explicitly changes preference. The TestLab method caused PC freezing; the direct method is the accepted path.

## V13-LITE MEMORY / FREEZE DIAGNOSTIC

V13-lite reuses the same Qwen3-8B V11 adapter/runtime and is a prompt/input-path candidate, not a newly trained adapter.

Memory-safe candidate adds a V13-lite-only semantic-text cap:

`EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS = 12000`

MailLens itself was not globally reduced.

Relevant commits:
- `f1b3524c14234294e116717c55dd9028bd28fe79` — 12k V13-lite model-input cap
- `c2e9b0f3211ed4029d9104db29dbea24476def97` — cap regression test.

Targeted REAL120 #43–47 evidence before the safer path:
- #43 OK, RAM ~75.3 -> 75.4%
- #44 OK, RAM ~75.4 -> 75.4%
- #45 `RUNTIME_TIMEOUT`, 20214 ms, RAM **75.4 -> 99.1%**, free RAM ~8.42 GB -> ~323 MB.

This directly explained the Windows stutter/freeze.

Important correction: #45 normalized `semanticText` is only **7120 chars**, not ~100k. The freeze was not simply caused by an enormous email; it is a runtime/attention/memory behavior triggered by this case. AMD/ROCm logs also warned that flash-efficient and memory-efficient attention on the current AMD GPU are experimental; relevant context, not proven sole root cause.

After the V13-lite memory-safe path, #45 whole-email mode no longer exhausted system RAM: RAM stayed ~74.9 -> 75.1%, but the case returned HTTP 503. Whole-email runtime behavior therefore remained imperfect.

## CHUNKING — REAL120 #45

Experimental settings:
- semantic text 7120 chars
- max chunk 3000 chars
- overlap 250 chars
- 3 chunks
- source fully covered.

Chunk-only diagnostic:
- chunk 1 -> `SHIPPED`
- chunk 2 -> `SHIPPED`
- chunk 3 -> `INVALID_MODEL_OUTPUT / COMMERCE_INVARIANT_MISMATCH`
- no timeout; RAM remained around ~80% instead of jumping to 99%.

Human truth for #45 is `OUT_FOR_DELIVERY`, so **naive majority voting is forbidden**.

## CHUNK45 + SHORT-EVIDENCE FINAL JUDGE — VERIFIED DEVELOPMENT PASS

Design:

`normalized email -> bounded chunks -> chunk predictions + short lifecycle evidence -> small final-judge Qwen call -> final event`

The final judge does not receive the whole email again.

Real #45 verified result on 2026-09-04:
- source semantic text: 7120 chars
- 3 chunks; full source coverage
- chunk 1: `SHIPPED`, 10913.9 ms, RAM 80.6 -> 80.7%
- chunk 2: `SHIPPED`, 6387 ms, RAM 80.7 -> 80.7%
- chunk 3: `INVALID_MODEL_OUTPUT / COMMERCE_INVARIANT_MISMATCH`, 3927.1 ms, RAM 80.7 -> 80.1%
- **final judge: `OUT_FOR_DELIVERY`**
- human truth: **`OUT_FOR_DELIVERY`**
- final-judge prompt: **2538 chars**
- final-judge elapsed: **3128.2 ms**
- final-judge RAM: **80.1 -> 80.1%**
- Gmail GET-only
- mailbox mutations 0
- BuyFlow DB writes 0
- production flags false
- no raw Gmail IDs/content/evidence persisted in report.

Interpretation:
- **specific #45 chunk+judge diagnostic: VERIFIED development PASS** for both correctness and memory stability;
- this does **not** close the EventMind production-quality gate;
- one successful known development case is insufficient for promotion;
- chunk-level invalid output remains visible and must not be hidden.

Relevant development commits/files:
- chunk TS introduced: `0792a897e92e48fb10102647a7ba90e4cde4bcab`
- direct chunk launcher script: `bf400677e1a28427336d57f476b3045970541699`
- final-judge experiment code: `14895b19ad03b3b0096262b57bbbc14b23ac8766`
- one-click final-judge direct launcher: `17c66e2bb61e17c46e6a12ca9f97dd971b084ab9`

Detailed launcher history, diagnostics and exact technical chronology are in `BUYFLOW_TECHNICAL_CONTINUITY.md`.

## SUPABASE / RAWVAULT REMINDER

- Production: `acjenqkrvnkdvvgordry`
- Actively-used old staging: `fsmhlexacbhnkdionpcg` — do not pause/repurpose it merely for RawVault smoke.
- Temporary smoke project: `hxbshnwxbntmmtdthjmk`, inactive.
- Supabase branching attempt was rejected because branching requires Pro; no paid branch exists and no branch charge is running.
- Do not fake real Storage behavior with direct `storage.objects` writes.

## CURRENT NEXT ACTION

1. Keep the #45 final-judge result as **single-case development evidence**, not promotion evidence.
2. Build/run one old-style DIRECT CMD on a **small diverse REAL120 development slice** using the same chunk + short-evidence final-judge strategy.
3. Include at minimum examples of:
   - OUT_FOR_DELIVERY
   - SHIPPED
   - READY_FOR_PICKUP
   - OTHER / merchant-outbound courier pickup
   - one or more previously invalid/runtime-problem cases.
4. Measure exact event vs known truth, chunk invalids, final-judge prompt size, timing, RAM, timeout/503 count, and writes=0.
5. If the wider development slice is acceptable, freeze the candidate design.
6. Then create a **new untouched holdout** for final unbiased EventMind validation.
7. Separately, RawVault real private Storage smoke remains required when a safe isolated environment is available.
8. Only after EventMind fresh-holdout quality and RawVault Storage evidence gates pass should a final production cutover review happen.
9. Production remains OFF until a separate explicit cutover decision.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md`, `BUYFLOW_HANDOFF.md` és `BUYFLOW_TECHNICAL_CONTINUITY.md` fájlokat a `codex/modern-email-source-foundation-v1` branchen. EventMind GPU teszteknél a régi DIRECT CMD módszert használd, ne TestLabot. REAL120 #45 chunk+short-evidence final judge már VERIFIED development PASS: final `OUT_FOR_DELIVERY`, human truth `OUT_FOR_DELIVERY`, judge prompt 2538 chars, RAM 80.1->80.1%, Gmail GET-only, writes 0, production OFF. Következő: szélesebb diverz REAL120 development slice ugyanezzel a módszerrel; utána candidate freeze és új untouched holdout. RawVault real private Storage smoke továbbra is külön nyitott gate. Production OFF.**