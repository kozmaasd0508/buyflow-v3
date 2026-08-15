# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older details remain in `BUYFLOW_WORKLOG.md` and Git history.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `09dc10193b2be8404dcdac2306caf4a28bd4b564`  
**Last reconciled runtime code commit:** `09dc10193b2be8404dcdac2306caf4a28bd4b564`  
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
- AI intentionally disabled. Historical `ai_processing_runs` remains **98**; latest AI run `2026-08-14 21:43:08.694227+00`.
- Release flow: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke -> live verification.

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle.
2. Multiple plausible candidates => REVIEW; never guess.
3. Strong identity first: exact order id / tracking id / verified merchant identity.
4. “Delivery today” != delivered.
5. Public/shared mailbox domains cannot alone establish merchant identity.
6. Packing / pre-advice / `shipment_created` cannot define physical `shipped_at`.
7. Historical reconstruction must not invent order date, tracking, carrier or document identity.
8. Documents must preserve provenance. PDF-derived evidence uses `email_attachment`, not `email_body`.
9. Private purchase documents stay in private storage; do not expose a public bucket URL.
10. Supabase DDL via migrations; guarded historical DML only with verified evidence.
11. Carrier identity must come from trusted carrier domain suffixes or stricter adapter identity, never brand tokens embedded in unrelated domains.

## NEW: ISOLATED DEMO MAILBOX BENCHMARK — PR #93

The user requested a brand-new demo account/mailbox with many order lifecycles to see what the recognition logic can handle. A fake Gmail/Nylas grant was deliberately **not** created. Instead, BuyFlow now has an isolated synthetic demo-mailbox benchmark that drives the same deterministic core without touching production purchases or real Gmail data.

Runtime commit: `09dc10193b2be8404dcdac2306caf4a28bd4b564`.
- PR #93 final CI #468 passed: **369/369 API tests**, API build, mobile typecheck and mobile web build green.
- Main CI #469 passed.
- Exact Render smoke #363 passed for the exact runtime commit.

Benchmark pipeline:
`lifecycle parser -> commerce parser -> validator -> Purchase resolver -> Shipment resolver -> lifecycle state safety`

Fixture set:
- **31 synthetic emails total**
- **20 must-positive real-commerce events**
- **8 hard-negative/noise messages**
- **3 probes**
- multilingual generic orders: HU / EN / DE / FR / ES
- COD
- GymBeam -> Express One full delivery lifecycle
- Gyerekjatekbolt failed payment -> cancellation
- AlzaBox internal lifecycle without tracking
- Szidibox public-mailbox packing + MPL shipped/out_for_delivery/ready_for_pickup
- shared-platform/public-mailbox/lookalike carrier/newsletter/OTP/subscription/survey/password-reset negatives
- probes for McDonald’s short POS id, generic DPD delivery-today and weak order-looking mail.

### First blind benchmark run

The first run intentionally failed and found two real defects:
1. Spanish order confirmation false negative: `pedido` in subject/context produced an early non-numeric regex candidate, preventing the parser from reaching the later explicit `Numero de pedido: ES-50005` body field.
2. Carrier identity security weakness: loose carrier brand-token matching allowed `gls-security.example` to enter deterministic carrier parsing.

No production data was changed by the benchmark failure.

### Fixes from the benchmark

Spanish order extraction now iterates later matches inside the same pattern until it finds a valid order identity containing a digit. Dedicated regression confirms a subject like `Confirmacion de pedido` no longer blocks a later labelled body order id.

Carrier sender identity was hardened from brand-name tokens to trusted domain suffixes. Current general trusted families include:
- Express One: `expressone.hu`
- GLS: `gls-hungary.com`, `gls-group.com`, `gls.hu`
- DPD: `dpd.com`, `dpd.hu`
- Foxpost: `foxpost.hu`
- Packeta: `packeta.hu`, `packeta.com`
- DHL: `dhl.com`, `dhl.hu`
- UPS: `ups.com`
- MPL: `posta.hu`

Legitimate subdomains remain supported, while lookalikes such as `gls-security.example`, `notify.dhl.com.attacker.example` and `email.gls-hungary.com.attacker.example` are rejected.

### Final benchmark result

- must-positive recognition: **20 / 20**
- hard-negative parser false positives: **0 / 8**
- directly creatable Purchase candidates in the generic resolution layer: **8**
- GymBeam / Express One: merchant anchor + two carrier events -> **linkable delivered Shipment**, `express-one`
- Gyerekjatekbolt: final state **cancelled**, payment status **failed**
- packing/pre-advice safety: older/weak packing evidence **does not downgrade physical shipment state**
- MPL pickup remains `ready_for_pickup`, not delivered
- Alza generic resolver remains `lifecycle_only`, which is expected; its strict specialized 90-day historical recovery lane handles real Purchase reconstruction
- Szidibox public Gmail evidence stays REVIEW in the generic Purchase resolver, which is expected; verified public-mailbox handling is specialized
- McDonald’s 4-digit POS probe stays unrecognized/held, intentionally safe
- weak order-looking email without confirmation evidence stays unrecognized/held
- generic DPD “delivery today / kézbesítés alatt” probe is recognized conservatively as a shipment with tracking, but the generic carrier parser still does **not** emit a dedicated `out_for_delivery` shipment phase. This is the clearest next benchmark-derived semantics gap.

The benchmark is now a permanent regression test, so these 31 scenarios run with the normal API suite on future changes.

## MULTI-GMAIL / REAL BLIND TEST

Multi-Gmail + per-account 7/30/90 deterministic full scans are live. The second real Gmail 30-day blind scan checked 149 messages with zero false automatic Purchases. Real misses are converted into reusable deterministic rules, not order-specific hard-codes.

For the strongest end-to-end validation on a truly brand-new Gmail, Google OAuth still requires the user to authorize that Gmail once in BuyFlow. After that, a real 30/90-day blind scan can be compared against the synthetic benchmark.

## PDF INVOICE ATTACHMENT INGESTION — PR #88

User-provided Activepieces source showed a useful pattern: fetch attachment bytes, extract PDF text, then process structured evidence. BuyFlow implements its own deterministic version around Nylas + Supabase.

Pipeline:
`Nylas message -> attachment metadata -> Nylas attachment bytes -> private Supabase Storage -> unpdf text layer -> pdf-invoice-v1 -> exact Purchase resolver -> controlled document RPC`

Rules:
- PDF only, max 10 MiB.
- Private bucket `buyflow-purchase-documents`, `public=false`, PDF MIME only.
- Raw PDF stored privately; full extracted PDF text is not persisted in Postgres.
- `email_attachments` durably tracks processing/review/error attempts and structured extraction.
- SHA-256 persisted for provenance.
- Generic PDF invoice requires explicit invoice identity + explicit order reference.
- Auto-link requires exactly one existing Purchase with same user + merchant domain + normalized order identity.
- Ambiguous/unmatched => REVIEW.
- Public mailbox merchants excluded from automatic document lane.
- No Purchase creation/lifecycle/money changes from attachment recovery.
- Scanned/raster PDF without text layer remains REVIEW; no OCR fallback in V1.
- AI 0.

### Jatekbolt live proof

Source `1d246ae8-8daf-4b49-9e73-7672d14864fe`, attachment `S26_044783.pdf`:
- 443,979 bytes downloaded from Nylas.
- Parser `pdf-invoice-v1` extracted invoice `S26_044783` and order reference `JB12247833`.
- exactly one invoice document linked to Purchase `12247833`.
- Existing Purchase remains 48,245 HUF, `delivered`; invoice total 48,248 HUF does not overwrite Purchase total.
- no duplicate.

Other PDFs lacking explicit invoice/order identity remain attachment REVIEW with `invoice_identity_not_found`.

## PRIVATE PDF OPENING — PR #91

Runtime base `f7d25a3384e864a45d5c9f10bff833b31304151a`.
- authenticated `GET /api/purchases/:id` proves Purchase ownership first.
- private stored email-attachment PDFs receive a **60-second** signed Supabase URL.
- storage bucket/path are never returned publicly.
- Purchase detail response uses `Cache-Control: no-store`.
- existing mobile/web `Megnyitás` link opens the temporary PDF URL.
- bucket stays private.

Expected Jatekbolt UX:
`Vásárlások -> JatekBolt.hu #12247833 -> Irattár / Dokumentumok -> Számla S26_044783 -> Megnyitás`.

## COMPLETED REAL-WORLD RECOVERY CASES

- Jatekbolt `12247833`: 48,245 HUF, Klarna, delivered DPD tracking `16380124260518`; invoice PDF ingested and privately openable.
- Alza `602385238`: strict internal AlzaBox historical recovery, 3,350 HUF, `ready_for_pickup`, exactly 1 Purchase, 0 Shipments, no invented dates/tracking.
- All In Packaging `148810` + GLS: 90-day proof historical reconstruction, 16,670 HUF COD, one safe Shipment; second no-COD tracking remains unlinked.
- Gyerekjatekbolt `535574`: payment failed + cancelled.
- Szidibox `SO-2024-30411` + MPL: public-mailbox safety, MPL deterministic lifecycle, correct physical `shipped_at`.
- Gate.shop/Foxpost, Scitec/BioTechUSA/Foxpost, Ars Una/GLS, Allegro/DPD, GymBeam/Express One and earlier deterministic cases remain covered.

Four McDonald's payment summaries remain REVIEW because reusable four-digit local/POS order ids are not safe global Purchase identities. Three Barion payment-only emails remain intentionally unlinked.

## CURRENT LIVE BACKLOG

Last verified source-email backlog before this benchmark-only runtime hardening:
- REVIEW: **34**
- unlinked: **10**
- unresolved source emails: **44**
- historical AI runs: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`.

PR #93 changes parser safety/recall and benchmark coverage; it did not itself run a production inbox scan or mutate Purchase/Shipment/Document rows.

## FRONTEND / DOCUMENT STATE

Working now:
- Purchase detail document metadata.
- Private stored PDF invoice returns short-lived signed `externalUrl` after authenticated Purchase ownership check.
- Existing `Megnyitás` link opens the temporary PDF URL.
- bucket remains private.

Remaining UI backlog: top-level lifecycle labels/counters, Warranty, Return/refund, Felfedezés. AI Flow remains hidden while AI is disabled.

## NEXT ACTION

If the user gives no different direction:
1. Fix the benchmark-derived generic DPD `out_for_delivery` shipment-phase gap without ever promoting “delivery today” to delivered.
2. Optionally connect a truly fresh Gmail via the normal BuyFlow OAuth UI and run a real 30/90-day blind test; OAuth authorization requires the user once.
3. Continue remaining 34 REVIEW + 10 unlinked physical-commerce clusters, including DPD tracking `16380124260338` and merchant evidence.
4. Extend deterministic PDF parsers only where real review attachments provide safe identity patterns; never infer from filename/timing alone.
5. Keep scanned PDFs REVIEW until a separately designed OCR lane exists.
6. Keep McDonald's/POS in REVIEW until a local/POS identity model exists.

## TEST QUALITY TARGET

- >=95% true purchase recognition across multiple mailboxes/merchants/carriers,
- false automatic Purchase = 0,
- wrong automatic link = 0,
- duplicate Purchase/Shipment/Document = 0,
- REVIEW preferred over unsafe automation.

## MAINTENANCE

This is a rolling snapshot, not a diary. Never store secrets, credentials or raw customer email/PDF bodies here. Detailed newest notes are in `BUYFLOW_WORKLOG_LATEST.md`; older history remains in `BUYFLOW_WORKLOG.md` and Git history.
