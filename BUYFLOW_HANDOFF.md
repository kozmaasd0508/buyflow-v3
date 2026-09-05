# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file. Use `BUYFLOW_TECHNICAL_CONTINUITY.md` and the newest technical log only when detailed test/debug history is needed.

**Last updated:** 2026-09-05 Europe/Budapest  
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

The chunk + short-evidence final-judge path completed all **120/120 REAL120 cases** using the DIRECT method.

Technical result:
- final judge valid: **119/120**
- runtime timeout/503 restart failures: **0**
- max system RAM: **80.3%**
- Gmail GET-only, writes 0, production OFF.

Semantic result vs known ground truth:
- strict exact: **44/120 = 36.67%**
- buyer-commerce: **40/76 = 52.63%**
- OTHER: **4/44 = 9.09%**.

Conclusion: **technical stability is strong, semantic accuracy is still unacceptable. Do not freeze or promote this candidate.** Main failure groups: OTHER/merchant-outbound and SHIPMENT_CREATED/SHIPPED-stage separation.

An interactive Teacher Mode V1 exists but its second-turn UX/runtime behavior was not yet verified successfully enough to use as the next gate.

A new **Prompt V4 decision-gate experiment** is prepared. It keeps the same V11 Qwen3-8B adapter/runtime and memory-safe chunk path, but replaces the sparse classifier instruction with a compact buyer-role gate plus explicit lifecycle boundaries for order, shipment, payment/invoice, cancellation/refund/return/warranty. `is_commerce` is derived only after `event_type`. Prompt code is frozen at commit `a61843c9e80a1c29582805e6e2f909595d855749` on branch `codex/eventmind-prompt-v4-real120`. **Prompt V4 REAL120 has not yet been run, so no accuracy claim exists yet.**

Local GPU/EventMind work must continue with the user's preferred DIRECT flow, not TestLab/self-hosted runner.

## Current next actions

1. Run the frozen Prompt V4 candidate on the same REAL120 development set using DIRECT and compare against 44/120 = 36.67%.
2. If Prompt V4 materially improves semantic accuracy without losing runtime stability, inspect class-level gains/regressions before any further change.
3. If prompt-only improvement remains insufficient, resume teacher/corpus -> reviewed LoRA training instead of endlessly expanding the prompt.
4. Separately fix the single `JUDGE_PROMPT_TOO_LARGE` case with bounded/prioritized evidence.
5. Freeze a candidate only after material semantic improvement; then create a new untouched holdout for unbiased validation.
6. RawVault real private Storage smoke remains a separate open gate.

## Resume contract

**Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md` és `BUYFLOW_HANDOFF.md` fájlt; részletes előzményhez a `BUYFLOW_TECHNICAL_CONTINUITY.md`-t és a legújabb technical logot. Production OFF. EventMind REAL120 chunk+judge baseline 44/120 = 36.67%. Új Prompt V4 decision-gate candidate készen áll, ugyanazzal a V11 adapterrel, frozen code commit `a61843c9e80a1c29582805e6e2f909595d855749`, frozen branch `codex/eventmind-prompt-v4-real120`; még NINCS lefuttatva. Következő lépés: DIRECT REAL120 Prompt V4 run, majd class-level összehasonlítás a 44/120 baseline-nal.**