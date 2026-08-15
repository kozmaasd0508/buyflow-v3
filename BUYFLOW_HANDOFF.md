# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older details remain in `BUYFLOW_WORKLOG.md` and Git history.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** includes runtime PR #91  
**Last reconciled runtime code commit:** `f7d25a3384e864a45d5c9f10bff833b31304151a`  
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

## PDF INVOICE ATTACHMENT INGESTION — PR #88

User-provided Activepieces source showed a useful pattern: fetch attachment bytes, extract PDF text, then process structured evidence. BuyFlow implements its own deterministic version around Nylas + Supabase.

Runtime base: `7c7732dc0d7e611ae534f5134744b066395fc247`.
- PR #88 CI #453 passed.
- Main CI #454 passed.
- Exact Render smoke #348 passed.

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
- Jatekbolt PDF identity requires `MODELL & HOBBY Kft.` + `jatekbolt.hu`, then normalizes `JB12247833` -> Purchase `12247833`.
- source `processed`, validated, `extraction_source=pdf_attachment`, confidence 0.995.
- exactly one invoice document exists:
  - Purchase `dfbe41c3-89f0-4f10-8dc8-e34923fba130`
  - document `52f22f74-460b-4cbe-a975-caedb25b6463`
  - invoice `S26_044783`
  - source_type `email_attachment`
  - filename `S26_044783.pdf`
  - private storage path + SHA-256 recorded.
- Existing Purchase remains 48,245 HUF, `delivered`; invoice total 48,248 HUF does not overwrite Purchase total.
- no duplicate.

Other PDFs lacking explicit invoice/order identity remain attachment REVIEW with `invoice_identity_not_found`.

## PR #89 — ATTACHMENT TABLE LEAST PRIVILEGE

Migration-only main `188340e1121fdaab6c64335f9214fa5b7d10fa1c`.
- `service_role` on `email_attachments` reduced to SELECT/INSERT/UPDATE/DELETE only.
- no anon/authenticated/public table grant.
- PR CI #455 + main CI #456 passed.

## NEW: PRIVATE PDF OPENING — PR #91

Runtime `f7d25a3384e864a45d5c9f10bff833b31304151a`.
- PR CI #459 passed.
- Main CI #460 passed.
- Exact Render smoke #354 passed for the exact runtime commit.

Behavior:
- authenticated `GET /api/purchases/:id` first proves Purchase ownership.
- document storage bucket/path are selected only internally for the already-owned Purchase.
- only `source_type=email_attachment` + `application/pdf` + valid private bucket/path get a signed URL.
- signed URL TTL is **60 seconds**.
- storage bucket/path are stripped from the public DTO; the client receives only temporary `externalUrl`.
- Purchase detail response has `Cache-Control: no-store`.
- signed URL generation failure is fail-safe: document metadata stays visible but no open link is emitted.
- existing mobile/web document UI already renders `externalUrl` as **Megnyitás**, so no new UI architecture was required.
- reopening Purchase detail generates a fresh signed URL.
- bucket remains private.

Expected live Jatekbolt UX:
`Vásárlások -> JatekBolt.hu #12247833 -> Irattár / Dokumentumok -> Számla S26_044783 -> Megnyitás`.

## COMPLETED REAL-WORLD RECOVERY CASES

- Jatekbolt `12247833`: 48,245 HUF, Klarna, delivered DPD tracking `16380124260518`; strict `jatekbolt-order-received-v1`; invoice PDF now ingested and privately openable.
- Alza `602385238`: strict internal AlzaBox historical recovery, 3,350 HUF, `ready_for_pickup`, exactly 1 Purchase, 0 Shipments, no invented dates/tracking.
- All In Packaging `148810` + GLS: 90-day proof historical reconstruction, 16,670 HUF COD, one safe Shipment; second no-COD tracking remains unlinked.
- Gyerekjatekbolt `535574`: payment failed + cancelled.
- Szidibox `SO-2024-30411` + MPL: public-mailbox safety, MPL deterministic lifecycle, correct physical `shipped_at`.
- Gate.shop/Foxpost, Scitec/BioTechUSA/Foxpost, Ars Una/GLS, Allegro/DPD, GymBeam/Express One and earlier deterministic cases remain covered.

Four McDonald's payment summaries remain REVIEW because reusable four-digit local/POS order ids are not safe global Purchase identities. Three Barion payment-only emails remain intentionally unlinked.

## CURRENT LIVE BACKLOG

Verified after first PDF attachment recovery:
- REVIEW: **34**
- unlinked: **10**
- unresolved source emails: **44**
- historical AI runs: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`.

`email_attachments` has its own REVIEW state and is not included in the above source-email backlog count.

## FRONTEND / DOCUMENT STATE

Working now:
- Purchase detail document metadata.
- Private stored PDF invoice returns short-lived signed `externalUrl` after authenticated Purchase ownership check.
- Existing `Megnyitás` link opens the temporary PDF URL.
- bucket remains private.

Remaining UI backlog: top-level lifecycle labels/counters, Warranty, Return/refund, Felfedezés. AI Flow remains hidden while AI is disabled.

## NEXT ACTION

If the user gives no different direction:
1. User/live browser verification of `JatekBolt.hu #12247833 -> S26_044783 -> Megnyitás`.
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
