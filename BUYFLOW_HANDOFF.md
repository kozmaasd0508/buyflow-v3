# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file. Use `BUYFLOW_TECHNICAL_CONTINUITY.md` and the newest technical log only when detailed test/debug history is needed.

**Last updated:** 2026-09-04 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Architecture branch:** `codex/modern-email-source-foundation-v1`  
**EventMind development branch:** `codex/buyflow-testlab-v1`

## Safety / production state

- Production remains OFF / unchanged.
- AI/EventMind classifies lifecycle semantics only; Purchase Identity Graph v2 remains the only identity/link/create/merge authority.
- Lifecycle-only email cannot create a Purchase; ambiguity/conflict stays REVIEW/PENDING.
- Direct Gmail production runtime, source archive, EventMind production runtime and TrustLink production writes remain OFF.
- JourneyGraph/DocVault/Core target production migrations remain NOT APPLIED.
- V11 remains the reference adapter; V12 is not promoted.
- Real Gmail model tests remain Gmail GET-only; no raw Gmail content/IDs are committed.

## Module state

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

- MailGate: PASS incl. real Gmail RAW + historyId/history.list gate; production OFF.
- RawVault: code/audit PASS; real private Supabase Storage + retention/orphan/account-deletion smoke still open due environment limits.
- MailLens: PASS.
- EventMind: code/runtime-safety PASS; **real-world semantic quality gate OPEN**.
- TrustLink: PASS incl. Gmail provider-auth; production writes OFF.
- JourneyGraph / DocVault / Core: isolated DB smoke PASS; production migrations not applied.
- Pulse: PASS / read-only.

## EventMind current state

REAL120 is now a **development set**, not a final blind holdout. V11 baseline was **41/120 = 34.17% strict exact**.

The chunk + short-evidence final-judge path has now completed all **120/120 REAL120 cases** using the DIRECT method.

Technical result:
- final judge valid: **119/120**
- final judge errors: **1**
- runtime timeout/503 restart failures: **0**
- max system RAM: **80.3%**
- chunk invalid outputs: **10**, but aggregation continued safely
- Gmail GET-only, writes 0, production OFF.

Semantic result vs known REAL120 ground truth:
- strict exact: **44/120 = 36.67%**
- improvement vs V11 baseline: only **+3 correct cases / +2.5 percentage points**
- buyer-commerce: **40/76 = 52.63%**
- OTHER: **4/44 = 9.09%**.

Conclusion: **technical stability is now strong, semantic accuracy is still unacceptable. Do not freeze or promote this candidate.** The main remaining semantic problems are OTHER/merchant-outbound detection and SHIPMENT_CREATED/SHIPPED-stage separation. READY_FOR_PICKUP and OUT_FOR_DELIVERY improved substantially, but other classes regressed enough that total accuracy barely moved.

Local GPU/EventMind tests must continue with the user's preferred DIRECT flow, not TestLab/self-hosted runner.

## Current next actions

1. Do not run a fresh holdout yet and do not promote the current chunk+judge candidate.
2. Use REAL120 as development data to fix the two dominant semantic failure groups: **OTHER/merchant-outbound** and **SHIPMENT_CREATED vs SHIPPED/later-stage confusion**.
3. Fix the single `JUDGE_PROMPT_TOO_LARGE` case by bounding/prioritizing aggregate evidence rather than increasing memory limits.
4. Re-run REAL120 development scoring after the targeted logic changes.
5. Freeze the candidate only when REAL120 development accuracy improves materially without losing the current runtime stability.
6. Then create a new untouched holdout for unbiased validation.
7. RawVault real private Storage smoke remains a separate open gate.

## Resume contract

**Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md` és `BUYFLOW_HANDOFF.md` fájlt; részletes technikai előzményhez a `BUYFLOW_TECHNICAL_CONTINUITY.md`-t és a legújabb technical logot. Production OFF. EventMind REAL120 chunk+short-evidence final judge 120/120 lefutott: technikailag stabil (119/120 valid final, timeout/503 0, max RAM 80.3%), de semantic strict exact csak 44/120 = 36.67%, ezért NEM promotion-ready. Fő következő munka: OTHER/merchant-outbound és SHIPMENT_CREATED/SHIPPED hibacsoport javítása, plusz az egyetlen JUDGE_PROMPT_TOO_LARGE eset bounded evidence megoldása; utána REAL120 development rerun, majd csak megfelelő eredmény után candidate freeze + új untouched holdout. RawVault Storage smoke külön nyitott gate.**