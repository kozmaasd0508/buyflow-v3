# BuyFlow V3 — persistent handoff

> Purpose: current-state snapshot for a new AI/chat. Read this before doing BuyFlow work. Historical detail belongs in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 12:52 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled main commit:** `1bef49b47c6a8d3168d1002c373c540a80cd3911`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do **not** ask the user to retell the project. Read `AGENTS.md`, this file and the newest worklog entries, compare them with current `main`, then continue.

The user's minimal resume phrase can be:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT GOAL

BuyFlow is an all-in-one purchase / delivery / invoice / warranty / return dashboard. It should turn chaotic purchase-related email chains into one safe, continuously updated purchase record, while keeping purchase creation separate from later lifecycle events.

## CURRENT ARCHITECTURE

- **Frontend/mobile web:** `apps/mobile`, served by Render at `/app/`; this same web build later becomes the Android app.
- **API/backend:** TypeScript in `apps/api`.
- **Database/auth:** Supabase production project `acjenqkrvnkdvvgordry`, region `eu-west-1`.
- **Email ingestion:** Nylas connection/webhook + durable email scan jobs.
- **Extraction:** deterministic parsers first where safe; guarded/review paths; OpenAI extraction infrastructure exists but AI is currently intentionally disabled for the live deterministic work described below.
- **Deployment:** GitHub Actions CI -> Render -> exact commit smoke verification.

## NON-NEGOTIABLE SAFETY RULES

1. **Purchase creation != lifecycle.** A shipment/delivery/invoice-only email must not create a new Purchase in normal flow.
2. Multiple candidate purchases => **REVIEW**, never unsafe auto-link.
3. Resolution preference is strong identity first: order ID, tracking identity, then narrower contextual fallbacks.
4. Carrier wording such as "delivery today" is not final delivery without completion evidence.
5. Historical reconstruction is a narrow multi-source exception only, never a loose generic rule.
6. Merchant-specific fixes must not weaken global matching rules.
7. Browser-first UI workflow. **Do not build an APK after every change.** APK only when the user explicitly asks/approves.
8. Supabase DDL via migrations; re-check advisors after DDL.
9. Production code: branch -> PR -> CI -> merge -> main CI -> exact Render smoke.

## LIVE FRONTEND STATE

Frontend catch-up is live. `apps/mobile/index.html` loads these modules in order:

1. `main.ts`
2. `password-reset-helper.ts`
3. `purchase-timeline-panel.ts`
4. `purchase-detail-overview-panel.ts`
5. `product-details-panel.ts`
6. `purchase-recovery-panel.ts`
7. `gmail-settings-panel.ts`
8. `email-scan-review-panel.ts`

User-visible capabilities already present:

- Login and main dashboard/purchase views.
- Purchase detail overview: current state + next action.
- Lifecycle timeline.
- Product detail list with safe edit/remove controls.
- Order/tracking/document details.
- "Hiányzik egy vásárlásom" targeted recovery entry point.
- Account -> `Email és Gmail` connection sheet.
- Connected Gmail state and advanced 7/30/90 audit controls.

Still incomplete on frontend:

- Warranty UI.
- Return/refund UI.
- `Felfedezés` and `Flow` V3 remain unfinished/placeholder.

## IMPORTANT BACKEND COMPLETED WORK

### Tracking / resolver hardening

- Unlinked Resolver V2.
- Tracking Bridge V2.1 through V2.6.
- Review Resolver V3.
- Carrier delivery semantic hardening.
- Hard tracking identity prevents cross-order tracking contamination.

Known corrected examples:

- GymBeam `3010206178` -> tracking `605855685055000013605231`.
- GymBeam `3010228912` -> tracking `605855685836000013605231`.
- JatekBolt `12247833` -> tracking `16380124260518`.

### Historical reconstruction

Historical Purchase Reconstruction V1 created exactly two previously missing GymBeam purchases from strict corroborated evidence:

- `3010206178`, confidence 0.90.
- `3010228912`, confidence 0.88.

### Documents

Corroborated Document Resolver V1 created exactly two GymBeam invoice documents without duplicates or AI calls:

- order `3010228912` -> invoice `4008874007`.
- order `3010206178` -> invoice `4008874475`.

### Security

- Legacy SECURITY DEFINER functions hardened with safe search path and restricted execute rights.
- Password reset token scrubbed from URL fragment immediately.
- Password reset policy: 12–128 chars, lower + upper + digit + special.
- Reset page has noindex/noarchive style protections and no-store/no-referrer behavior.
- Supabase leaked-password protection was **not** toggled because the available connector could not safely change it. Do not claim otherwise.
- Remaining INFO advisor items are service-only RLS tables without user policies; do not add broad policies merely to silence the advisor.

### Noise cleanup

Unlinked Noise Cleanup V1 reduced irrelevant unresolved email noise. After cleanup the unresolved backend backlog was roughly:

- shipment 38
- delivery 6
- invoice 4
- payment_completed 4

Dominant deferred cluster at that point: Express One shipment emails. This work was intentionally deferred while higher-value frontend/parser work continued.

## LATEST REAL EMAIL PARSER WORK

### Alza safety

Real order `602385238` had a chain similar to:

- processing started
- handed to carrier / delayed state
- ready for pickup in AlzaBox

The rule is intentionally conservative: those lifecycle messages do **not** create a new Purchase by themselves. Live verification showed **0 Alza Purchase** created for this test case.

### Allegro / HappyBox24

A real Allegro purchase email from seller `HappyBox24` exposed multiple HTML/text normalization issues. Current live deterministic result is now correct:

- event: `order_created`
- parser: `allegro-order-v1.4`
- order UUID: `3fe09c80-8d79-11f1-b193-cf13a29b46f5`
- merchant: `HappyBox24`
- marketplace domain: `allegro.com`
- total: **5,675 HUF**
- shipping: **1,990 HUF**
- payment status: `cash_on_delivery`
- payment method: `utánvét`
- shipping method: `Futár utánvét, DPD`
- expected carrier: `DPD`
- product SKU `18383644800`: **1,830 HUF**
- product SKU `18421709712`: **1,855 HUF**
- Purchase state: `processing`
- Purchase confidence: `0.995`

Live AI-run counter stayed at **98**, with no new AI call during this deterministic repair sequence.

### Long transactional email handling

PR #43 increased deterministic compacted-email visibility from 20k to 80k characters and added a regression test for order evidence after the old cutoff. All safety gates remained unchanged.

### Temporary Allegro diagnostics

PR #44 added safe diagnostics for unmatched Allegro messages. It stores only lengths/boolean signal presence, never the email body. This was useful to diagnose Nylas/HTML behavior.

**Cleanup note:** now that the real HappyBox24 message is parsing as `allegro-order-v1.4`, review whether PR #44 diagnostics are still needed. Prefer removing temporary diagnostics once confidence is established.

## EMAIL AUDIT / RECOVERY NOTES

Earlier 30-day audit example:

- 701 checked
- 470 AI calls in that older audit period
- 485 ignored
- 138 unlinked
- 65 review
- 13 processed
- observe-only writes = 0

Important historical caveat: the native Gmail purchase-category benchmark was invalid because the expected exact category marker was absent from Nylas. Full audit still scans inbox correctly. Do not use that old benchmark to claim native category accuracy.

## CURRENT DEPLOYMENT / CI EXPECTATION

Latest verified production sequence before this handoff:

- PR CI passed.
- Main CI passed.
- Exact Render Webhook Smoke passed, including:
  - exact deployment health
  - browser preview
  - password reset page
  - app API auth requirement
  - mobile CORS allowlist
  - Nylas challenge handshake
  - webhook secret enforcement

Never assume future `main` is deployed merely because a merge succeeded; verify exact commit smoke again.

## NEXT ACTION

When the user gives no new direction and only says to continue:

1. Reconcile this handoff with current `main` and recent PRs.
2. Remove/retire the temporary Allegro diagnostics if no longer needed, without changing parser behavior.
3. Continue testing remaining real `review/unlinked` commerce emails with deterministic, evidence-based rules; do not loosen global creation gates.
4. Keep the Express One bulk backlog deferred unless it becomes the chosen focus.
5. For user-facing development, the next major frontend gap is **Warranty + Return/Refund UI**, then `Felfedezés/Flow`.

If the user names a different focus, follow that instead.

## IMPORTANT WORKFLOW PREFERENCES

- The user prefers implementation and live verification over theory-only discussion.
- Do not repeatedly ask for confirmation when the requested direction is clear.
- For UI, let the user test in the browser before producing an APK.
- Report concrete results: what changed, whether CI passed, whether exact deploy is live, and what remains.

## MAINTENANCE RULE FOR THIS FILE

This is a **rolling snapshot**, not a diary. After meaningful work:

- replace stale current-state statements,
- update `Last updated` and reconciled `main` SHA,
- update `NEXT ACTION`,
- put historical details in `BUYFLOW_WORKLOG.md`,
- keep secrets and raw customer content out.
