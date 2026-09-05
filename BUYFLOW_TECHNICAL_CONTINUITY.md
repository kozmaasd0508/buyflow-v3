# BuyFlow V3 — technical continuity log

> Purpose: detailed technical continuity for chat resets, context-window exhaustion, handoffs between sessions, and debugging after long test sequences.
>
> Always read in this order before continuing technical work:
> 1. `AGENTS.md`
> 2. `BUYFLOW_HANDOFF.md`
> 3. `BUYFLOW_TECHNICAL_CONTINUITY.md`
> 4. newest protocol/worklog relevant to the module being changed.
>
> This file is intentionally more detailed than `BUYFLOW_HANDOFF.md`. The handoff is the executive/current-state summary; this file preserves concrete technical decisions, exact failure modes, commands/launchers, test-method preferences, evidence, and unfinished experiments.

**Last updated:** 2026-09-04 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Primary architecture branch:** `codex/modern-email-source-foundation-v1`  
**EventMind development branch:** `codex/buyflow-testlab-v1`  
**Production:** OFF / unchanged for all work described below.

---

## CONTINUITY RULES

After every meaningful technical event, update this file with the new state. Meaningful events include:
- a new test run or diagnostic result;
- a new failure mode or corrected root-cause hypothesis;
- a code or prompt change;
- a new launcher/script/workflow;
- a new commit that changes the active development path;
- a decision to reject/replace a testing method;
- a safety-state change;
- a new blocker or a blocker being closed;
- a change to the exact next action.

Do not overwrite history by pretending an earlier hypothesis was always correct. Record corrections explicitly.

Do not commit raw Gmail message content, raw Gmail IDs, credentials, OAuth tokens, private fixtures, or local model secrets. Sanitized hashes, counts, metrics, event labels, timings, memory figures, commit SHAs and launcher names are allowed.

Never claim a test PASS unless actual output or CI evidence was observed. Never claim a launcher ran merely because it was created.

---

## USER TEST-METHOD PREFERENCE — IMPORTANT

For local GPU/EventMind tests, the user explicitly prefers the old direct local flow:

`one CMD -> local n8n Gmail OAuth -> local Qwen -> real Gmail read-only -> Desktop report`

Do **not** default EventMind GPU tests back to GitHub Actions/TestLab/self-hosted runner. The user reported the newer TestLab method freezes the PC, while the older direct method did not.

GitHub/TestLab remains usable for non-GPU/core CI when appropriate, but EventMind real-Gmail model testing should stay DIRECT unless the user explicitly changes this preference.

---

## EVENTMIND MODEL / RUNTIME BASELINE

Current reference adapter/runtime remains V11:
- model: `Qwen/Qwen3-8B`
- adapter SHA: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- deterministic generation
- thinking OFF
- strict two-key output: `is_commerce`, `event_type`
- EventMind has no Purchase identity/link/create/merge authority.

V12 is not promoted.

V13/V13-lite are development candidates reusing the same V11 adapter/runtime; they are prompt/input-path experiments, not newly trained adapters unless explicitly stated otherwise later.

---

## REAL120 FROZEN DATASET

Frozen 120 Gmail message-ID pool was selected by Gmail search IDs before contents were inspected. Known Batch19 IDs were excluded.

Canonical newline-joined ID SHA256:

`88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470`

REAL120 V11 first baseline run:
- GitHub TestLab run #7
- run id `33676590636`
- job id `100402725296`
- head `5b8926cc75afb407004506e07328ffc3ec5cc939`
- result FAILED
- 84 valid outputs / 120
- 36 errors
- error breakdown: 30 `INVALID_MODEL_OUTPUT/INVALID_VALUES`, 1 `INVALID_MODEL_OUTPUT/COMMERCE_INVARIANT_MISMATCH`, 3 `RUNTIME_TIMEOUT`, 2 `RUNTIME_HTTP_ERROR/503`
- mailbox writes 0
- BuyFlow DB writes 0.

Important interpretation:
- 84/120 = 70% valid-output rate, **not accuracy**.
- Post-freeze human ground truth later showed strict exact event accuracy `41/120 = 34.17%`.
- REAL120 ceased being a fresh holdout after human labels were read and then used for V13/V13-lite development.
- V13/V13-lite REAL120 results are development comparisons only. Final unbiased validation requires a new untouched holdout.

Ground-truth headline weaknesses of V11:
- merchant/outbound courier pickup often confused with buyer purchase lifecycle;
- SHIPPED weak;
- READY_FOR_PICKUP weak.

Known REAL120 #45 human ground truth: `OUT_FOR_DELIVERY`.

---

## V13 / V13-LITE HISTORY

Initial V13 had a longer buyer-lifecycle prompt and triggered poor local runtime behavior on the user PC.

TestLab V13 history:
- run #8 id `33681610060`, job `100419260663`: long timeout cascade, later Gmail 401 after token expiry, technically unusable for full quality scoring;
- run #9 id `33775107330`: failed; user reported machine freezing;
- run #10 was later cancelled after user rejected the TestLab method for EventMind tests.

V13-lite was then created to stay much closer to the V11 prompt and add only REAL120-proven distinctions.

Memory-safe V13-lite constants introduced on `codex/buyflow-testlab-v1`:
- `EVENTMIND_V13_SOURCE_VERSION = eventmind-v13-prompt-v3-lite-memory-safe`
- `EVENTMIND_V13_PROMPT_VERSION = real120-targeted-lite-v3-memory-safe`
- `EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS = 12000`

Relevant commits:
- `f1b3524c14234294e116717c55dd9028bd28fe79` — V13-lite 12k semantic-text model-input cap
- `c2e9b0f3211ed4029d9104db29dbea24476def97` — regression test for the cap

The 12k cap is intentionally at the V13-lite model-input layer. MailLens itself was **not** globally reduced.

---

## DIRECT TEST LAUNCHER HISTORY

Known sequence:
- V1 direct: exact commit check failed under PowerShell/Git handling.
- V2: wrapper fetched inner script from a commit where the direct script did not exist -> 404.
- V3/V4: PowerShell `$ErrorActionPreference='Stop'` + ordinary Git stderr/progress caused false failures.
- V5: StrictMode interpolation bug around `$CodeCommit`.
- V6: exact SHA still unavailable in selected shallow/local repo state.
- V7: oversized embedded CMD/PowerShell effectively did not start; do not reuse that pattern.
- V8: first robust small CMD + remote PS script path that reached real Gmail and local Qwen.
- V9: attempted checkpoint/resume + automatic Qwen restart after timeout; real run showed memory/freeze problem persisted around #45.

Important launcher/state names:
- `BuyFlow-EVENTMIND-V13-LITE-REAL120-DIRECT-V8.cmd`
- `BuyFlow-EVENTMIND-V13-LITE-REAL120-DIRECT-V9.cmd`
- `BuyFlow-EVENTMIND-REAL5-GPU-DIAGNOSTIC.cmd`
- `BuyFlow-EVENTMIND-REAL5-MEMORY-SAFE-RETEST.cmd`
- `BuyFlow-EVENTMIND-CHUNK45-DIAGNOSTIC.cmd`
- `BuyFlow-EVENTMIND-CHUNK45-FINAL-JUDGE-DIAGNOSTIC.cmd`

Do not assume any local `/mnt/data` launcher still exists in a later session; recreate from GitHub script state if needed.

---

## PC FREEZE / MEMORY ROOT-EVIDENCE SEQUENCE

### 1. V8/V9 symptom
A direct real120 V13-lite run reached real model inference and was responsive through many cases, then showed timeout/freeze behavior around #45 and later timeout cascades. User reported the PC becoming very laggy.

Task Manager during one run showed roughly:
- CPU ~74%
- memory ~57% at that screenshot moment
- disk ~64%
- `VmmemWSL` was a major CPU consumer.

This did **not** prove the PC was too weak. Later targeted diagnostics identified a specific memory spike.

### 2. Targeted REAL5 diagnostic before memory-safe retest
Target indices: 43–47.

Observed:
- #43 OK `ORDER_PACKING`, 6791 ms, RAM ~75.3 -> 75.4%
- #44 OK `ORDER_CREATED`, 2966 ms, RAM ~75.4 -> 75.4%
- #45 `RUNTIME_TIMEOUT`, 20214 ms, CPU 63.6%
- #45 system RAM ~75.4 -> **99.1%**
- free system RAM ~8.42 GB -> **~323 MB**.

This was the direct evidence explaining the Windows stutter/freeze.

### 3. Important hypothesis correction
Initial working hypothesis was that #45 was probably an enormous email near the MailLens 100k semantic-text bound.

That hypothesis was later disproven by chunk diagnostics:
- #45 normalized `semanticText` = **7120 chars**
- structured-data JSON = **2 chars**
- no detached bodies hydrated.

Therefore the freeze was **not simply caused by a giant 100k email**. It was a runtime/attention/memory behavior triggered by this case.

AMD/ROCm runtime logs also warned that flash-efficient and memory-efficient attention on the current AMD GPU are experimental. Keep this as relevant context, but do not treat it as proven sole root cause.

### 4. Memory-safe retest after V13-lite 12k cap
Same REAL5 target after the memory-safe candidate path:
- #43 OK `ORDER_PACKING`
- #44 OK `ORDER_CREATED`
- #45 `RUNTIME_HTTP_ERROR HTTP 503` in 7226 ms
- #45 RAM stayed **74.9 -> 75.1%**
- #46 OK `ORDER_PROCESSING` in 13246 ms
- #47 OK `ORDER_PACKING` in 3281 ms
- no early timeout.

Interpretation:
- the catastrophic system-RAM spike was mitigated in this path;
- #45 still had a runtime/GPU-side failure as a whole-email request;
- do not claim the underlying AMD/ROCm whole-email root cause is fully solved.

---

## CHUNKING EXPERIMENT — REAL120 #45

Goal: split problematic/long semantic text into bounded pieces so one request cannot create the same memory pressure, while preserving the entire email instead of blindly truncating its tail.

Experiment settings:
- source semantic text: 7120 chars
- chunk max: 3000 chars
- overlap: 250 chars
- chunks planned: 3
- source fully covered: true
- Gmail GET-only
- BuyFlow writes 0
- production flags OFF
- no raw Gmail content persisted in report.

Observed chunk results in the first chunk-only diagnostic:
- chunk 1: `SHIPPED`, 2908 semantic chars, 5698 prompt chars, 10432 ms, RAM 80.6 -> 80.4%
- chunk 2: `SHIPPED`, 2851 semantic chars, 5610 prompt chars, 6011 ms, RAM 79.8 -> 79.8%
- chunk 3: invalid model output `COMMERCE_INVARIANT_MISMATCH`, 1752 semantic chars, 3994 prompt chars, 4056 ms, RAM 79.9 -> 80.9%
- no runtime timeout.

Conclusion:
- chunking is promising for stability/memory on this problematic case;
- **naive majority voting is not acceptable** because human truth for #45 is `OUT_FOR_DELIVERY` while the two valid chunks both said `SHIPPED`.

Relevant code:
- `apps/api/src/scripts/eventmind-v13-real-gmail-chunk45-diagnostic.ts`
- introduced commit `0792a897e92e48fb10102647a7ba90e4cde4bcab`
- direct chunk launcher script `scripts/run-eventmind-v13-lite-chunk45-diagnostic-direct.ps1`
- launcher commit `bf400677e1a28427336d57f476b3045970541699`.

---

## CHUNK45 FINAL JUDGE — VERIFIED DEVELOPMENT PASS ON #45

Design:

`normalized email -> bounded chunks -> chunk predictions + short lifecycle evidence -> small final-judge Qwen call -> one final event`

Reason:
- retain chunking's memory stability;
- avoid naive majority voting;
- do not resend the whole email to the final judge;
- final judge sees only short evidence and chunk outcomes.

Relevant commits:
- final-judge experiment code: `14895b19ad03b3b0096262b57bbbc14b23ac8766`
- one-click DIRECT final-judge launcher: `17c66e2bb61e17c46e6a12ca9f97dd971b084ab9`

Launcher:
- `BuyFlow-EVENTMIND-CHUNK45-FINAL-JUDGE-DIAGNOSTIC.cmd`

### Verified real Gmail #45 result — 2026-09-04
Report suite: `EVENTMIND_V13_LITE_REAL_GMAIL_CHUNK45_JUDGE_DIAGNOSTIC_V1`.

Source/chunking:
- target index: 45
- source semantic text: **7120 chars**
- detached bodies hydrated: 0
- chunk max: 3000 chars
- overlap: 250 chars
- chunks planned: 3
- source fully covered: true.

Chunk results:
- chunk 1: OK `SHIPPED`, 2908 chars, 10913.9 ms, CPU 56.7%, RAM 80.6 -> 80.7%, evidence windows 3
- chunk 2: OK `SHIPPED`, 2851 chars, 6387 ms, CPU 56.1%, RAM 80.7 -> 80.7%, evidence windows 2
- chunk 3: `INVALID_MODEL_OUTPUT / COMMERCE_INVARIANT_MISMATCH`, 1752 chars, 3927.1 ms, CPU 59.6%, RAM 80.7 -> 80.1%, evidence windows 1.

Final judge:
- **OK `OUT_FOR_DELIVERY`**
- known human ground truth for #45: **`OUT_FOR_DELIVERY`**
- therefore exact on this development case
- final-judge prompt: **2538 chars**
- elapsed: **3128.2 ms**
- CPU during judge: **63.7%**
- system RAM: **80.1 -> 80.1%**
- no memory spike, no timeout, no 503 in final judge.

Safety verified in report:
- Gmail methods: GET only
- mailbox mutations: 0
- BuyFlow DB writes: 0
- production flags enabled: false
- raw Gmail IDs persisted: false
- message content persisted: false
- final-judge evidence text persisted: false.

Interpretation:
- **chunk + short-evidence final judge works correctly and stably on the single known problematic #45 case**;
- this closes the specific #45 diagnostic question, not the EventMind production-quality gate;
- this is a REAL120 development result, not an unbiased holdout result;
- do not promote based on one case;
- chunk 3 still demonstrates strict-decoder/model-quality failure can occur at chunk level, so aggregation must tolerate partial invalid chunks without hiding them from diagnostics.

---

## SAFETY STATE — MUST REMAIN TRUE

- Production Direct Gmail runtime OFF.
- Production source/archive OFF.
- Production EventMind runtime OFF.
- TrustLink production writes OFF.
- Legacy automatic Purchase/payment Core writes OFF/fail-closed.
- JourneyGraph/DocVault/Core target production migrations not applied.
- No AI Purchase identity authority.
- No production provider cutover.
- Gmail diagnostic reads are GET-only.
- Test reports persist hashes/metrics, not raw Gmail IDs/content.

---

## NON-EVENTMIND MODULE STATE

9-module code audit remains complete:

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

High-level state:
- MailGate real Gmail RAW + historyId/history.list gate PASS.
- MailLens code PASS.
- EventMind code audit PASS, but real Gmail quality gate remains OPEN.
- TrustLink Gmail provider-auth PASS, production writes OFF.
- JourneyGraph isolated DB smoke PASS, production migration not applied.
- DocVault isolated DB smoke PASS, production migrations not applied.
- Core isolated DB smoke PASS, legacy writes OFF, production migration not applied.
- Pulse PASS/read-only.
- RawVault code/audit PASS, but real private Supabase Storage + retention/orphan/account-deletion smoke remains unresolved due environment limits.

Supabase reminder:
- production `acjenqkrvnkdvvgordry`
- old staging `fsmhlexacbhnkdionpcg` is actively used; do not pause/repurpose it for RawVault smoke
- temporary smoke `hxbshnwxbntmmtdthjmk` inactive
- branch creation was rejected because Supabase branching requires Pro; no paid branch exists, no branch charge is running.

---

## EXACT NEXT ACTION

1. Do **not** immediately promote the chunk+judge strategy from one successful case.
2. Build/run one old-style DIRECT CMD development slice across a small but diverse set of known REAL120 cases, including at minimum:
   - OUT_FOR_DELIVERY
   - SHIPPED
   - READY_FOR_PICKUP
   - OTHER / merchant-outbound courier pickup
   - at least one prior invalid/runtime-problem case.
3. Measure per case: exact event vs known ground truth, valid/invalid chunk outputs, final-judge prompt size, elapsed time, RAM before/after, timeout/503 count, and safety writes=0.
4. If the wider REAL120 development slice is acceptable, freeze the candidate design.
5. Create a **new untouched holdout** for final unbiased EventMind validation. REAL120 cannot be reused as the final holdout.
6. Keep EventMind GPU tests on the old DIRECT CMD method, not TestLab/self-hosted runner unless the user explicitly changes preference.
7. RawVault real private Storage smoke remains separately required when a safe isolated environment becomes available.

---

## RESUME CONTRACT

If a new chat starts or context is lost, tell the next assistant:

**"Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md`, `BUYFLOW_HANDOFF.md` és `BUYFLOW_TECHNICAL_CONTINUITY.md` fájlokat a `codex/modern-email-source-foundation-v1` branchen. EventMind GPU teszteknél ne használj TestLabot, a régi DIRECT CMD módszert használd. REAL120 #45 chunk+short-evidence final judge már VERIFIED development PASS: final `OUT_FOR_DELIVERY`, human truth `OUT_FOR_DELIVERY`, judge prompt 2538 chars, RAM 80.1->80.1%, Gmail GET-only, writes 0, production OFF. Következő: szélesebb, diverz REAL120 development slice chunk+judge módszerrel; utána candidate freeze és új untouched holdout. Production OFF."**