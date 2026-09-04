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

An **interactive EventMind Teacher Mode V1** is now prepared on `codex/buyflow-testlab-v1` to turn known REAL120 mistakes into supervised local teaching conversations. It uses the same DIRECT Gmail + local Qwen path, stores private training conversations only under local `local-data`, and keeps a separate safe summary. **Teacher Mode has not yet been run/verified.** Detailed design: `docs/technical/EVENTMIND-TEACHER-MODE-V1-2026-09-04.md`.

Local GPU/EventMind work must continue with the user's preferred DIRECT flow, not TestLab/self-hosted runner.

## Current next actions

1. Run Teacher Mode on a few high-value OTHER/merchant-outbound mistakes and inspect the safe summary.
2. Distill accepted private teaching sessions into a clean supervised training corpus; do not commit raw/private email data.
3. Train a new LoRA candidate only after corpus review, then re-run REAL120 development scoring.
4. Separately fix the single `JUDGE_PROMPT_TOO_LARGE` case with bounded/prioritized evidence.
5. Freeze a candidate only after material semantic improvement without losing runtime stability; then create a new untouched holdout.
6. RawVault real private Storage smoke remains a separate open gate.

## Resume contract

**Folytasd a BuyFlowot a GitHubból. Először olvasd el az `AGENTS.md` és `BUYFLOW_HANDOFF.md` fájlt; részletes előzményhez a `BUYFLOW_TECHNICAL_CONTINUITY.md`-t és a legújabb technical logot. Production OFF. EventMind REAL120 chunk+judge technikailag stabil, de strict exact csak 44/120 = 36.67%, ezért NEM promotion-ready. Következő irány: interaktív Teacher Mode V1 a domináns OTHER/merchant-outbound és SHIPMENT_CREATED/SHIPPED hibákból tanítóbeszélgetések gyűjtésére; Teacher Mode még nincs lefuttatva/igazolva. Utána corpus review -> új LoRA candidate -> REAL120 development rerun. RawVault Storage smoke külön nyitott gate.**