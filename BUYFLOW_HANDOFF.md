# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older details remain in `BUYFLOW_WORKLOG.md` and Git history.

**Last updated:** 2026-08-16 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current runtime main:** `8f41524bdd361b326464ab92e7d3645b0ae8191f`  
**Last reconciled runtime code commit:** `8f41524bdd361b326464ab92e7d3645b0ae8191f`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this snapshot with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns chaotic purchase, delivery, invoice, warranty and return emails into one safe Purchase record.

- Frontend/mobile web: `apps/mobile`, Render `/app/`; APK only when explicitly requested.
- Backend: TypeScript in `apps/api`.
- Database/auth/storage: Supabase production `acjenqkrvnkdvvgordry`, eu-west-1.
- Email: Nylas webhook + durable full-inbox/targeted scans.
- Recognition: deterministic-first; ambiguity => REVIEW.
- AI intentionally disabled. Historical `ai_processing_runs` remains **98**; latest historical AI run `2026-08-14 21:43:08.694227+00`.
- Release flow: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke -> live verification.

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle.
2. Multiple plausible candidates => REVIEW; never guess.
3. Strong identity first: exact order id / tracking id / verified merchant identity.
4. “Delivery today” != delivered.
5. Public/shared mailbox domains cannot alone establish merchant identity.
6. Packing / pre-advice / `shipment_created` cannot define physical `shipped_at`.
7. Historical reconstruction must not invent order date, tracking, carrier or document identity.
8. Documents preserve provenance; PDF-derived evidence uses `email_attachment`, not `email_body`.
9. Private purchase documents stay in private storage.
10. Supabase DDL via migrations; guarded historical DML only with verified evidence.
11. Carrier identity must use exact trusted carrier domain or a true subdomain suffix. A trusted domain appearing in the middle of an attacker-controlled hostname is never sufficient.

## NEW: WEB-DERIVED UNSEEN EMAIL BENCHMARK — PR #95

The user no longer had another fresh Gmail, so we sourced **publicly documented notification types** from official Shopify and WooCommerce documentation and converted those semantics into synthetic, non-customer test emails. The fixtures do not copy private emails; they are deliberately new patterns not present in the first demo mailbox.

Runtime commit: `8f41524bdd361b326464ab92e7d3645b0ae8191f`.
- first PR CI #472 failed usefully on a carrier-domain lookalike.
- final PR CI #473 passed: **370/370 API tests**, API build, mobile typecheck and mobile web build green.
- main CI #474 passed.
- exact Render smoke #368 passed for the exact runtime commit.

### New corpus

24 additional synthetic emails, bringing the two benchmark corpora to **55 total fixtures**.

Shopify-like unseen types:
- order edited
- order canceled
- partial refund
- shipping confirmation
- shipping update
- ready for local pickup
- picked up
- return created
- return approved
- exchange balance due / action required
- pending payment success
- POS receipt with short local id

WooCommerce-like unseen types:
- failed payment
- on hold
- processing
- completed
- full refund
- partial refund
- invoice/order-details payment link

Carrier/security probes:
- DPD out for delivery
- DHL delivered
- UPS in transit
- DHL attacker-domain lookalike
- account-reset noise

### Security defect found and fixed

PR #93 had already hardened the central `sender-role.ts` carrier classifier, but this new web benchmark exposed a **second independent carrier-domain matcher** inside `deterministic-commerce-parser.ts`.

Before the fix, `alerts@notify.dhl.com.attacker.example` could enter the generic carrier parser because the old matcher accepted the text `dhl.com` inside a larger attacker domain. The benchmark failed instead of being weakened.

The matcher now requires:
`normalized === trusted || normalized.endsWith('.' + trusted)`.

Therefore real carrier subdomains remain valid, while `dhl.com.attacker.example`, `gls-hungary.com.attacker.example`, etc. are rejected.

### Final web benchmark result

- fixtures: **24**
- currently recognized by deterministic core: **3**
- safely held/unrecognized: **21**
- dangerous new-Purchase classifications among the unseen lifecycle set: **0**
- DPD out-for-delivery: recognized as `shipment`, never delivered, tracking preserved; generic phase still null
- DHL delivered: recognized as `delivery`
- UPS in transit: recognized as `shipment`
- DHL attacker-domain lookalike: rejected
- POS short id: held
- account-reset noise: held

The low 3/24 number is **not an overall BuyFlow recognition rate**. Most of the 24 fixtures are deliberately new post-purchase lifecycle types that should update an existing Purchase, not create one. The benchmark is a gap map.

### 18 important coverage gaps exposed

Shopify-like:
`order edited`, `order cancelled`, `partial refund`, `shipping confirmation`, `shipping update`, `ready for pickup`, `picked up`, `return created`, `return approved`, `exchange balance due`, `pending payment success`.

WooCommerce-like:
`failed payment`, `on hold`, `processing`, `completed`, `full refund`, `partial refund`, `invoice/payment link`.

These must be added as lifecycle-safe semantics anchored to an existing Purchase identity; do **not** solve them with a broad generic order-creation regex.

The highest-value next work is:
1. generic trusted merchant shipping confirmation/update with exact order + tracking anchors;
2. generic payment failed/on-hold/processing/cancelled semantics;
3. partial/full refund semantics;
4. ready-for-pickup / picked-up semantics;
5. return/exchange data model and lifecycle handling;
6. generic DPD `out_for_delivery` shipment phase.

## ISOLATED DEMO MAILBOX BENCHMARK — PR #93

Permanent synthetic benchmark of 31 emails:
- 20 must-positive commerce/lifecycle events
- 8 hard-negative/noise messages
- 3 probes
- HU/EN/DE/FR/ES generic orders, COD, GymBeam/Express One, Gyerekjatekbolt failed-payment/cancel, AlzaBox, Szidibox/MPL and noise/security cases.

First run found and fixed Spanish order-id extraction and central carrier sender token matching.

Final #93 result:
- **20/20 must-positive recognized**
- **0/8 hard-negative false parser matches**
- 8 generic directly creatable Purchase candidates
- GymBeam/Express One correctly final `delivered`
- Gyerekjatekbolt correctly `failed` + `cancelled`
- MPL pickup `ready_for_pickup`, never delivered
- packing/pre-advice cannot downgrade physical shipment progress.

Runtime `09dc10193b2be8404dcdac2306caf4a28bd4b564`; PR CI #468, main CI #469 and exact Render smoke #363 passed.

## MULTI-GMAIL / REAL BLIND TEST

Multi-Gmail + per-account 7/30/90 deterministic full scans are live. The second real Gmail 30-day blind scan checked 149 messages with zero false automatic Purchases. Real misses are converted into reusable deterministic rules, not order-specific hard-codes.

A truly fresh Gmail would still be the strongest end-to-end validation, but Google OAuth requires the user to authorize that Gmail once. The public-web benchmark is the substitute when no additional real mailbox is available.

## PDF INVOICE ATTACHMENT INGESTION — PR #88

Pipeline:
`Nylas message -> attachment metadata -> Nylas attachment bytes -> private Supabase Storage -> unpdf text layer -> pdf-invoice-v1 -> exact Purchase resolver -> controlled document RPC`

Rules:
- PDF only, max 10 MiB.
- private bucket `buyflow-purchase-documents`.
- full extracted PDF text is not persisted in Postgres.
- exact invoice identity + order reference required.
- exactly one existing Purchase required for auto-link.
- ambiguous/unmatched => REVIEW.
- public mailbox merchants excluded from automatic generic document lane.
- no Purchase creation/lifecycle/money changes from attachment recovery.
- scanned/raster PDF without text remains REVIEW; no OCR fallback in V1.
- AI 0.

Jatekbolt live proof: invoice `S26_044783`, PDF order reference `JB12247833` -> Purchase `12247833`; private document linked exactly once; Purchase remains 48,245 HUF delivered.

## PRIVATE PDF OPENING — PR #91

- authenticated Purchase ownership check first.
- private stored email-attachment PDFs get a 60-second signed Supabase URL.
- bucket/path never returned publicly.
- Purchase detail uses `Cache-Control: no-store`.
- mobile/web `Megnyitás` opens the temporary URL.

## COMPLETED REAL-WORLD RECOVERY CASES

- Jatekbolt `12247833`: 48,245 HUF, Klarna, delivered DPD tracking `16380124260518`; invoice PDF privately openable.
- Alza `602385238`: 3,350 HUF, `ready_for_pickup`, exactly 1 Purchase, 0 Shipments, no invented dates/tracking.
- All In Packaging `148810` + GLS: 90-day proof reconstruction, 16,670 HUF COD, one safe Shipment.
- Gyerekjatekbolt `535574`: payment failed + cancelled.
- Szidibox `SO-2024-30411` + MPL: public-mailbox safety + correct physical lifecycle.
- Gate.shop/Foxpost, Scitec/BioTechUSA/Foxpost, Ars Una/GLS, Allegro/DPD, GymBeam/Express One and earlier deterministic cases remain covered.

Four McDonald's payment summaries remain REVIEW because reusable four-digit local/POS ids are not safe global Purchase identities. Three Barion payment-only emails remain intentionally unlinked.

## CURRENT LIVE BACKLOG

Last verified source-email backlog before benchmark-only runtime hardening:
- REVIEW: **34**
- unlinked: **10**
- unresolved source emails: **44**
- historical AI runs: **98**.

The benchmark PRs do not themselves mutate Purchase/Shipment/Document rows.

## FRONTEND / DOCUMENT STATE

Working:
- Purchase detail document metadata.
- short-lived private invoice PDF opening.

Remaining UI/product backlog includes lifecycle labels/counters, Warranty, Return/refund and Felfedezés. AI Flow remains hidden while AI is disabled.

## NEXT ACTION

If the user gives no different direction, use the new web benchmark as the roadmap. Start with the high-confidence post-purchase lifecycle gaps rather than loosening Purchase creation:
1. generic DPD `out_for_delivery` phase;
2. trusted merchant shipping confirmation/update anchored by exact existing Purchase + tracking;
3. cancellation / payment failed / on-hold / processing;
4. refund partial/full;
5. pickup ready/picked-up;
6. returns/exchanges after their data model is explicit.

## TEST QUALITY TARGET

- >=95% true purchase recognition across multiple mailboxes/merchants/carriers,
- false automatic Purchase = 0,
- wrong automatic link = 0,
- duplicate Purchase/Shipment/Document = 0,
- REVIEW preferred over unsafe automation.

## MAINTENANCE

This is a rolling snapshot, not a diary. Never store secrets, credentials or raw customer email/PDF bodies here. Detailed newest notes are in `BUYFLOW_WORKLOG_LATEST.md`; older history remains in `BUYFLOW_WORKLOG.md` and Git history.
