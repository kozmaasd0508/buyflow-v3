# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled main commit:** `2bac53d5550236023824b08cbefc9fd8a708652c`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Read the repository handoff and reconcile it with current `main`, live Supabase state and the latest deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT GOAL

BuyFlow is an all-in-one purchase, delivery, invoice, warranty and return dashboard. It should turn chaotic commerce email chains into one safe, continuously updated Purchase while keeping initial purchase creation separate from later lifecycle events.

The intended scale is large: many users, many mailbox providers, many merchants and carriers. Do not design fixes that only work for one user's mailbox unless they are explicitly narrow merchant/carrier adapters behind safe generic rules.

## CURRENT ARCHITECTURE

- Frontend/mobile web: `apps/mobile`, served by Render at `/app/`; later packaged as Android.
- API/backend: TypeScript in `apps/api`.
- Database/auth: Supabase production project `acjenqkrvnkdvvgordry`, region `eu-west-1`.
- Email ingestion: Nylas webhook + durable email scan/recovery jobs.
- Extraction: deterministic parsers first, guarded review for uncertain commerce mail.
- AI infrastructure still exists but **AI is intentionally disabled** for current production recognition work. `BUYFLOW_AI_ENABLED` defaults false.
- Deployment: GitHub Actions CI -> Render -> exact-commit smoke verification.

## NON-NEGOTIABLE SAFETY RULES

1. Purchase creation and lifecycle are separate. A shipment, delivery, invoice or payment-only email must not create a new Purchase in normal flow.
2. Multiple plausible matches => REVIEW, never unsafe auto-link.
3. Strong identity first: order ID, tracking identity, then narrow contextual fallbacks.
4. Carrier text such as “delivery today” is not final delivered without completion evidence.
5. Merchant-specific fixes must not weaken global matching rules.
6. Gmail categories are advisory only; they must never be a required purchase gate.
7. Shared platform senders and public mailbox domains cannot by themselves establish merchant identity.
8. Browser-first UI workflow. Do not build an APK unless the user explicitly asks/approves.
9. Supabase DDL via migrations. Re-check advisors after DDL.
10. Production code: branch -> PR -> CI -> merge -> main CI -> exact Render smoke.

## LIVE FRONTEND STATE

`apps/mobile/index.html` currently loads:

1. `main.ts`
2. `password-reset-helper.ts`
3. `purchase-timeline-panel.ts`
4. `purchase-detail-overview-panel.ts`
5. `product-details-panel.ts`
6. `purchase-recovery-panel.ts`
7. `gmail-settings-panel.ts`
8. `ai-off-ui.ts`

Current user-visible capabilities include login, purchase list/detail, current state/next action, lifecycle timeline, product edit/remove, order/tracking/document details, targeted missing-purchase recovery, and Gmail connection/settings.

AI audit/Flow UI is intentionally hidden while deterministic recognition is being improved.

Frontend gaps still include:
- Warranty UI.
- Return/refund UI.
- `Felfedezés` unfinished.
- `Flow` should remain hidden while AI is off.

## CURRENT EMAIL RECOGNITION DIRECTION

### Gmail category independence

A real Limone order confirmation landed in Gmail `CATEGORY_PERSONAL`, proving Gmail categorization cannot be trusted as a gate. The global category gate was removed. BuyFlow now evaluates signed incoming mail with its own deterministic filters/parsers regardless of Personal/Updates/etc.

### Generic order parser

Generic deterministic order recognition is live for unknown merchants when strong independent order evidence exists. Tests cover multiple Shopify/WooCommerce/Magento/Shoprenter/PrestaShop/BigCommerce/Squarespace-like structures and multilingual examples. Newsletters, abandoned carts, carrier-only mail, invoice-only mail and payment-only mail must not become new Purchases.

Shared platform sender domains and public mailbox domains are intentionally blocked from automatic merchant identity when no stronger store identity exists.

### Known live examples

- Limone order `98691-106627` was recovered from a non-Purchases Gmail category with deterministic evidence and 0 AI calls.
- Allegro / HappyBox24 order UUID `3fe09c80-8d79-11f1-b193-cf13a29b46f5` now parses with `allegro-order-v1.4`; live values include total 5,675 HUF, shipping 1,990 HUF, COD and DPD, with two product rows 1,830 HUF and 1,855 HUF.
- Alza `602385238` lifecycle chain remains conservative: processing/delay/pickup messages did not create a false Purchase.

## LATEST: EXPRESS ONE OUTBOUND PICKUP NOISE

PR #47 merged as main commit `2bac53d5550236023824b08cbefc9fd8a708652c`.

Root cause found in real review/unlinked data: Express One also emails confirmations for **outbound courier pickup bookings** made through its WEBCAS service. Wording such as “köszönjük megrendelését” looked purchase-like, but the messages describe `árufelvétel` / courier pickup service, not a consumer webshop purchase or inbound parcel lifecycle.

Fix:
- exact/subdomain Express One sender required,
- strong `árufelvétel` plus WEBCAS `request_curier` or equivalent operational pickup evidence required,
- such mail is excluded from commerce processing,
- real incoming Express One parcel/delivery mail remains eligible,
- regression tests cover both positive pickup-noise cases and negative real-parcel cases.

Historical cleanup after exact deployment:
- 43 unresolved `Expressone értesítés%` pickup-service rows identified,
- 5 had been false `order_created`,
- 38 had been false `shipment`,
- 0 were linked to any Purchase,
- all 43 were changed to audited `ignored/other`, preserving their superseded machine result inside the cleanup JSON,
- unresolved pickup-noise remainder is now **0**.

Five different Express One unresolved rows were deliberately left untouched because they are not this pickup pattern:
- 2 × `Fizetési bizonylat`
- 1 × delivered/questionnaire mail
- 1 × delivery-today/ETA mail
- 1 × shipment-processing mail

These require separate interpretation.

PR #47 also removed the temporary Allegro fallback diagnostics from PR #44. HappyBox24 recognition remains deterministic.

## CURRENT LIVE BACKLOG SNAPSHOT AFTER EXPRESS ONE CLEANUP

At the last live check:
- all `review`: **38**
- all `unlinked`: **29**
- Express One outbound-pickup noise remaining: **0**
- distinct Express One review/unlinked rows remaining: **5**

Historical AI counter at the same check:
- total `ai_processing_runs`: **98**
- latest historical run: `2026-08-14 21:43:08.694227+00`
- no new AI run was created by the Express One work.

Re-check live values before making future time-sensitive claims.

## IMPORTANT COMPLETED SAFETY / BACKEND WORK

- Unlinked Resolver V2.
- Tracking Bridge V2.1–V2.6 and hard tracking identity.
- Review Resolver V3.
- Carrier delivery semantic hardening.
- Strict historical reconstruction for two GymBeam purchases.
- Corroborated Document Resolver for two GymBeam invoices.
- Product edit/remove with evidence preservation.
- SECURITY DEFINER hardening.
- Password reset token scrub + stronger password policy.
- Long deterministic email visibility raised from 20k to 80k characters with regression coverage.

Known corrected tracking examples:
- GymBeam `3010206178` -> `605855685055000013605231`
- GymBeam `3010228912` -> `605855685836000013605231`
- JatekBolt `12247833` -> `16380124260518`

## NEXT ACTION

If the user gives no different direction:

1. Inspect the **5 remaining distinct Express One** review/unlinked rows separately; do not apply the outbound-pickup rule to them.
2. Clean/repair the old false `order_created` marketing rows already verified as promotions (Goddess/Shopify promo, Galaxy promo, Sport8 coupon) using exact-message or safely generalizable rules.
3. Leave BF-TEST Gmail synthetic examples in review; public-mailbox protection is intentional.
4. Continue through real `review/unlinked` commerce clusters by frequency/value, always using real evidence and deterministic regression tests.
5. Once email recognition is very strong without AI, return to Warranty + Return/Refund frontend work, then other user-facing gaps.

## WORKFLOW PREFERENCES

- User prefers actual implementation and live verification over long theory.
- Keep user-facing updates short and simple.
- Do not repeatedly ask for confirmation when direction is clear.
- For UI: browser test first, APK only on explicit request.
- Report concrete outcomes: what changed, counts before/after, CI, exact deploy, AI calls, and remaining work.

## MAINTENANCE RULE

This is a rolling snapshot, not a diary. After meaningful work:
- update the reconciled main SHA and current state,
- replace stale statements,
- update `NEXT ACTION`,
- put historical detail in `BUYFLOW_WORKLOG.md`,
- never store secrets, tokens, passwords or raw customer email bodies here.
