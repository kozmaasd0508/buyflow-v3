# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file. Use `BUYFLOW_TECHNICAL_CONTINUITY.md` only when detailed test/debug history is needed.

**Last updated:** 2026-09-04 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Architecture branch:** `codex/modern-email-source-foundation-v1`  
**EventMind development branch:** `codex/buyflow-testlab-v1`

## Safety / production state

- Production remains OFF / unchanged.
- AI/EventMind may classify lifecycle semantics only; it has no Purchase identity/link/create/merge authority.
- Purchase Identity Graph v2 remains the only identity authority.
- Lifecycle-only email cannot create a Purchase.
- Ambiguous/conflicting identity stays REVIEW/PENDING.
- Direct Gmail production runtime, source archive, EventMind production runtime and TrustLink production writes remain OFF.
- JourneyGraph/DocVault/Core target production migrations remain NOT APPLIED.
- V11 remains the reference adapter; V12 is not promoted.
- Real Gmail model tests are read-only; raw Gmail content/IDs are not committed.

## Module state

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

- MailGate: PASS incl. real Gmail RAW + historyId/history.list gate; production OFF.
- RawVault: code/audit PASS; real private Supabase Storage + retention/orphan/account-deletion smoke still open due environment limits.
- MailLens: PASS.
- EventMind: code/runtime-safety PASS; **real-world semantic quality gate still OPEN**.
- TrustLink: PASS incl. Gmail provider-auth; production writes OFF.
- JourneyGraph / DocVault / Core: isolated DB smoke PASS; production migrations not applied.
- Pulse: PASS / read-only.

## EventMind current state

REAL120 was a valid blind baseline for V11, but its ground truth is now known, so it is only a **development set** for V13/V13-lite. V11 REAL120 strict exact baseline was **41/120 = 34.17%**. Final validation must use a new untouched holdout after the candidate is frozen.

Local GPU/EventMind tests must use the user's preferred old DIRECT flow:

`one CMD -> local n8n Gmail OAuth -> local Qwen -> Gmail GET-only -> Desktop report`

Do not default back to TestLab/self-hosted runner for EventMind GPU tests.

The problematic REAL120 #45 previously caused a severe system-RAM spike and timeout in whole-email mode. The current memory-safe/chunked path prevents that catastrophic RAM behavior.

The **chunk + short-evidence final judge** experiment on #45 is now **VERIFIED development PASS**:
- final event: `OUT_FOR_DELIVERY`
- human truth: `OUT_FOR_DELIVERY`
- memory remained stable
- Gmail GET-only, writes 0, production OFF.

This is only single-case development evidence, not production-readiness evidence.

## Current next actions

1. Test the same chunk + short-evidence final-judge method on a small, diverse REAL120 development slice (OUT_FOR_DELIVERY, SHIPPED, READY_FOR_PICKUP, OTHER/merchant-outbound, and prior problem cases).
2. If behavior is acceptable, freeze the candidate design.
3. Create a **new untouched holdout** for unbiased EventMind validation.
4. Separately, complete the RawVault real private Storage smoke when a safe isolated environment is available.
5. Only after both gates pass should final production cutover review happen.

## Resume contract

**Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md` és `BUYFLOW_HANDOFF.md` fájlt; részletes technikai előzményhez a `BUYFLOW_TECHNICAL_CONTINUITY.md`-t. Production OFF. EventMind real-world quality gate nyitott. REAL120 már development set. A #45 chunk+short-evidence final judge VERIFIED development PASS és stabil memória mellett `OUT_FOR_DELIVERY`-t adott. Következő: szélesebb diverz REAL120 development slice, majd candidate freeze és új untouched holdout. RawVault real private Storage smoke külön nyitott gate.**