# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older details remain in `BUYFLOW_WORKLOG.md` and Git history.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** includes migration-only PR #89  
**Last reconciled runtime code commit:** `7c7732dc0d7e611ae534f5134744b066395fc247`  
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
- Release flow: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke -> live DB verification.

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

## MULTI-GMAIL / BLIND TEST

Multi-Gmail + per-account 7/30/90 deterministic full scans are live. Second Gmail 30-day blind scan checked 149 messages with zero false automatic Purchases. Real misses are converted into reusable deterministic rules, not order-specific hard-codes.

## NEW: PDF INVOICE ATTACHMENT INGESTION — PR #88

User-provided Activepieces source showed a useful pattern: fetch attachment bytes, extract PDF text, then process structured evidence. BuyFlow now implements its own deterministic version around Nylas + Supabase.

Runtime commit: `7c7732dc0d7e611ae534f5134744b066395fc247`.
- PR #88 CI #453 passed after updating two legacy EmailProvider test doubles.
- Main CI #454 passed.
- Exact Render smoke #348 passed for the exact runtime commit.

### Pipeline

`Nylas message -> attachment metadata -> Nylas attachment bytes -> private Supabase Storage -> unpdf text layer -> pdf-invoice-v1 -> exact Purchase resolver -> controlled document RPC`

Rules:
- PDF only, max 10 MiB.
- Private bucket: `buyflow-purchase-documents`, `public=false`, allowed MIME only `application/pdf`.
- Raw PDF is stored privately; full extracted PDF text is **not** persisted in Postgres.
- `email_attachments` durably tracks pending/processing/processed/review/ignored/error, attempts and structured extraction.
- SHA-256 is persisted for provenance.
- Generic PDF invoice requires explicit invoice number + explicit order reference.
- Auto-link requires exactly one existing Purchase with same user + merchant domain + normalized order identity.
- Ambiguous/unmatched => REVIEW.
- Public mailbox merchants are excluded from this automatic document lane.
- No Purchase creation, no lifecycle changes, no monetary Purchase changes, AI 0.
- Scanned/raster PDF without a text layer remains REVIEW; no OCR fallback in V1.

### Jatekbolt live proof

Source email `1d246ae8-8daf-4b49-9e73-7672d14864fe`, attachment `S26_044783.pdf`:
- Nylas attachment downloaded successfully: 443,979 bytes.
- Parser `pdf-invoice-v1` extracted invoice `S26_044783` and PDF order reference `JB12247833`.
- Jatekbolt-specific identity requires `MODELL & HOBBY Kft.` + `jatekbolt.hu` inside the document, then normalizes `JB12247833` -> existing Purchase order `12247833`.
- Source is now `processed`, validated, `extraction_source=pdf_attachment`, confidence 0.995.
- Exactly 1 invoice document exists:
  - Purchase `dfbe41c3-89f0-4f10-8dc8-e34923fba130`
  - document `52f22f74-460b-4cbe-a975-caedb25b6463`
  - type invoice
  - number `S26_044783`
  - source_type `email_attachment`
  - filename `S26_044783.pdf`
  - MIME `application/pdf`
  - private storage path + SHA-256 recorded.
- Existing Purchase remained unchanged: 48,245 HUF, `delivered`, same ordered/shipped/delivered timestamps.
- The invoice itself is 48,248 HUF; attachment identity does not overwrite Purchase order totals.
- Exactly one attachment + one invoice document; no duplicate.

Other PDFs discovered during the first live recovery that lacked sufficient explicit invoice/order identity remained REVIEW with `invoice_identity_not_found`; they were not linked automatically.

## PR #89 — ATTACHMENT TABLE LEAST-PRIVILEGE HARDENING

Migration-only main commit `188340e1121fdaab6c64335f9214fa5b7d10fa1c`.
- Production inspection showed `service_role` inherited technical table grants beyond CRUD on `email_attachments`.
- Follow-up migration revokes all and grants only SELECT/INSERT/UPDATE/DELETE.
- `anon` / `authenticated` / `public` have no table grant.
- PR CI #455 and main CI #456 passed.
- No runtime recognition logic changed.

## COMPLETED REAL-WORLD RECOVERY CASES

- Jatekbolt `12247833`: 48,245 HUF, Klarna, delivered DPD tracking `16380124260518`; strict `jatekbolt-order-received-v1`; now invoice attachment also linked.
- Alza `602385238`: strict internal AlzaBox historical recovery, 3,350 HUF, `ready_for_pickup`, exactly 1 Purchase, 0 Shipments, no invented dates/tracking.
- All In Packaging `148810` + GLS: 90-day proof historical reconstruction, 16,670 HUF COD, one safe Shipment; second no-COD tracking remains unlinked.
- Gyerekjatekbolt `535574`: payment failed + cancelled.
- Szidibox `SO-2024-30411` + MPL: public-mailbox safety, MPL deterministic lifecycle, correct physical `shipped_at`.
- Gate.shop/Foxpost, Scitec/BioTechUSA/Foxpost, Ars Una/GLS, Allegro/DPD, GymBeam/Express One and other earlier deterministic cases remain covered.

Four McDonald's payment summaries remain REVIEW because reusable four-digit local/POS order ids are not safe global Purchase identities. Three Barion payment-only emails remain intentionally unlinked.

## CURRENT LIVE BACKLOG

Verified after the first PDF attachment recovery:
- REVIEW: **34**
- unlinked: **10**
- unresolved source emails: **44**
- historical AI runs: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`.

`email_attachments` has its own REVIEW state and is not included in the above source-email backlog count.

## FRONTEND / DOCUMENT NEXT STEP

Purchase detail already returns document metadata, but private stored PDFs do not have a public `external_url` by design.

Next document UX:
1. authenticated API verifies the document belongs to the user's Purchase,
2. backend creates a short-lived signed Supabase Storage URL,
3. web/mobile opens the invoice through that signed URL,
4. never make `buyflow-purchase-documents` public.

Other UI backlog remains: top-level lifecycle labels/counters, Warranty, Return/refund, Felfedezés. AI Flow remains hidden while AI is disabled.

## NEXT ACTION

If the user gives no different direction:
1. Add authenticated signed document-download/open endpoint and wire it into Purchase detail UI.
2. Continue remaining 34 REVIEW + 10 unlinked physical-commerce clusters, starting with DPD tracking `16380124260338` and merchant evidence.
3. Extend deterministic PDF parsers only where real review attachments provide safe identity patterns; never infer from filename/timing alone.
4. Keep scanned PDFs REVIEW until a separately designed OCR lane exists.
5. Keep McDonald's/POS in REVIEW until a local/POS identity model exists.
6. Add verified public-mailbox merchant identity before auto-creating Purchases from legitimate Gmail-sender merchants.

## TEST QUALITY TARGET

- >=95% true purchase recognition across multiple mailboxes/merchants/carriers,
- false automatic Purchase = 0,
- wrong automatic link = 0,
- duplicate Purchase/Shipment/Document = 0,
- REVIEW preferred over unsafe automation.

## MAINTENANCE

This is a rolling snapshot, not a diary. Never store secrets, credentials or raw customer email/PDF bodies here. Detailed newest notes are in `BUYFLOW_WORKLOG_LATEST.md`; older history remains in `BUYFLOW_WORKLOG.md` and Git history.
