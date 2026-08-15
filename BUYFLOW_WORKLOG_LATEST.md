# BuyFlow V3 — latest recovery worklog

> Newest detailed entries. Read this after `BUYFLOW_HANDOFF.md`; older historical entries remain in `BUYFLOW_WORKLOG.md` and Git history.

## 2026-08-15 — isolated demo mailbox benchmark

### Goal

The user asked to test BuyFlow against a completely fresh account/mailbox containing many orders and different lifecycle paths. We did not fabricate a Gmail/Nylas OAuth grant or inject synthetic commerce data into production. Instead, PR #93 adds an isolated synthetic mailbox benchmark that executes the same deterministic parsing/validation/resolution/state logic and is now part of the normal API regression suite.

### Coverage

31 synthetic emails:
- 20 mandatory commerce/lifecycle positives
- 8 hard-negative/noise messages
- 3 probes

Scenarios include HU/EN/DE/FR/ES generic order confirmations, COD, GymBeam + Express One full delivery lifecycle, Gyerekjatekbolt failed payment + cancellation, AlzaBox without carrier tracking, Szidibox public Gmail packing + MPL shipped/out-for-delivery/pickup, and noise from shared platforms, public mailboxes, lookalike carriers, newsletters, OTP, subscriptions, surveys and password-reset mail.

Benchmark order mirrors the deterministic core:
`lifecycle parser -> commerce parser -> validator -> Purchase resolution -> Shipment resolution -> lifecycle state safety`.

### First blind run: failed usefully

The first run found two real defects rather than being adjusted to pass:

1. Spanish order false negative. `Confirmacion de pedido` / `Gracias por tu pedido` caused the Spanish order regex to accept an earlier non-numeric candidate and never reach the later explicit `Numero de pedido: ES-50005` field.
2. Carrier identity security weakness. Loose brand-token matching allowed `gls-security.example` to enter generic carrier parsing as GLS.

First-run metrics before fixes:
- 19/20 must-positive recognized
- 1/8 hard negatives entered deterministic parsing
- 7 generic direct Purchase candidates
- GymBeam/Express One still linked to delivered correctly
- Gyerekjatekbolt still ended cancelled + payment failed
- packing monotonicity safety held.

### Fixes

Spanish order id extraction now scans successive matches in a pattern until a candidate containing a digit is found. Dedicated regression proves subject/context `pedido` wording cannot hide the later labelled body id.

Carrier identity moved from loose brand tokens to trusted domain suffixes. General trusted domains now include Express One `expressone.hu`; GLS `gls-hungary.com`, `gls-group.com`, `gls.hu`; DPD `dpd.com`, `dpd.hu`; Foxpost `foxpost.hu`; Packeta `packeta.hu`, `packeta.com`; DHL `dhl.com`, `dhl.hu`; UPS `ups.com`; MPL `posta.hu` in sender-role classification. Legitimate subdomains remain supported; lookalikes such as `gls-security.example` and trusted-domain-prefix attacker domains are rejected.

Added dedicated carrier-domain safety tests plus two benchmark regressions for Spanish order id and GLS lookalike rejection.

### Final result

PR #93 final head `9573e9b18f026e1f18b443b4fb0f5d37b63b18f9`.
- PR CI #468: **369/369 API tests passed**, API build passed, mobile typecheck/build passed.
- merged runtime `09dc10193b2be8404dcdac2306caf4a28bd4b564`.
- main CI #469 passed.
- exact Render smoke #363 passed for the exact runtime commit.

Final machine-readable benchmark:
- fixtures: 31
- must positives: **20/20 recognized**
- hard negatives: **0/8 false positive parser matches**
- generic directly creatable Purchases: **8**
- GymBeam/Express One: one linkable shipment, final `delivered`, carrier `express-one`, 3 evidence rows
- Gyerekjatekbolt: final Purchase state `cancelled`, payment status `failed`
- packing evidence does not downgrade physical shipment state
- MPL pickup remains `ready_for_pickup`, never delivered.

Probe results:
- McDonald’s short 4-digit POS id: intentionally not recognized, still requires a safe local/POS identity model.
- weak rich order without confirmation evidence: intentionally not recognized.
- generic DPD delivery-today: carrier + tracking recognized and guardrailed as shipment, but generic path currently emits no explicit `out_for_delivery` phase. This is the clearest next benchmark-derived gap; fix it without ever treating delivery-today as delivered.

Other expected safety behavior:
- Alza evidence stays lifecycle-only in the generic resolver; the existing specialized 90-day historical recovery lane is responsible for Purchase reconstruction.
- Szidibox Gmail evidence remains REVIEW in generic Purchase resolution; verified public-mailbox logic is specialized.
- MPL carrier evidence without a synthetic merchant Purchase anchor remains unmatched in the generic shipment resolver, while the MPL lifecycle parser itself correctly recognizes shipped/out-for-delivery/ready-for-pickup phases.

A truly fresh Gmail remains the strongest end-to-end follow-up. Google OAuth requires the user to authorize that Gmail once through BuyFlow; after that, run a 30/90-day blind scan and compare it against this benchmark.

---

## 2026-08-15 — private invoice PDF opening

### PR #91 — signed PDF URLs in Purchase detail

- Runtime commit `f7d25a3384e864a45d5c9f10bff833b31304151a`.
- PR CI #459 passed completely.
- Main CI #460 passed completely.
- Exact Render smoke #354 passed for the exact runtime commit.
- No migration and no Purchase/Shipment/Document writes.

Behavior:
- `GET /api/purchases/:id` already verifies the Purchase belongs to the authenticated user before loading children.
- For document rows with `source_type=email_attachment`, `mime_type=application/pdf`, private `storage_bucket` and `storage_path`, and no permanent external URL, the backend creates a Supabase signed URL with a 60-second TTL.
- Storage bucket/path are used only internally and are stripped by the public document DTO; the client receives only the temporary HTTPS URL.
- Purchase detail response is `Cache-Control: no-store`.
- If signed URL creation fails, the document remains visible as saved metadata but no open link is emitted.
- The existing mobile/web `documentsSection()` already renders `externalUrl` as the `Megnyitás` link, so no new UI architecture or public bucket was needed.
- Reopening Purchase detail generates a fresh signed URL.
- AI remains off / 0 calls.

Expected live UX for the proven Jatekbolt invoice:
- Purchase `12247833` -> Irattár / Dokumentumok -> `Számla` / `S26_044783` -> `Megnyitás`.
- Link opens the private `S26_044783.pdf` through Supabase signed access.

---

## 2026-08-15 — Activepieces-inspired PDF attachment ingestion

### Source idea used

The user-provided Activepieces source was inspected for reusable patterns. The useful parts for this task were its attachment byte handling and PDF text extraction architecture. BuyFlow did **not** embed Activepieces or replace its deterministic core; it implemented a native Nylas/Supabase document lane with BuyFlow safety gates.

### PR #88 — deterministic invoice attachment ingestion

- Branch `agent/attachment-pdf-ingestion-v1`.
- First PR CI #452 failed only because two old `EmailProvider` test doubles lacked the new `downloadAttachment()` method. No production migration had been applied at that point.
- Updated the mocks; final PR CI #453 passed completely.
- Merged runtime `7c7732dc0d7e611ae534f5134744b066395fc247`.
- Main CI #454 passed.
- Exact Render smoke #348 passed for that exact runtime commit.

Implementation:
- `EmailProvider.downloadAttachment(messageId, attachmentId)` added.
- Nylas provider uses attachment byte download scoped by grant + message + attachment.
- Added `unpdf` 1.4.0 text-layer extraction, PDF magic check and 250k text cap.
- Added `pdf-invoice-v1` deterministic parser.
- Generic invoice requires explicit invoice identity + explicit order reference.
- Exact user + merchant-domain + normalized-order resolver requires one and only one existing Purchase; ambiguity or no match => REVIEW.
- Jatekbolt PDF rule additionally requires `MODELL & HOBBY Kft.` and `jatekbolt.hu` inside the PDF, and normalizes `JB<digits>` to the existing Jatekbolt order identity.
- No Purchase creation, lifecycle updates, or Purchase money updates in attachment recovery.
- Public-mailbox senders are excluded from this auto-document lane.
- Scanned PDF without text layer => REVIEW; no OCR in V1.
- AI calls = 0.

Database/storage migration:
- private `buyflow-purchase-documents` bucket, PDF-only, max 10 MiB.
- new durable `email_attachments` table with attempts/status/extraction/storage/hash provenance.
- `documents` extended with storage bucket/path + SHA-256.
- controlled SECURITY DEFINER attachment-document RPC verifies user, Purchase, source email, provider message, attachment provenance, PDF MIME, storage metadata/hash, invoice/order identity and confidence.

### First live proof — Jatekbolt invoice

Source `1d246ae8-8daf-4b49-9e73-7672d14864fe`, provider message `19fcbf6460a149b8`:
- attachment `S26_044783.pdf`
- 443,979 bytes
- private Storage object created successfully
- parser `pdf-invoice-v1`
- extracted invoice `S26_044783`
- PDF order reference `JB12247833` -> Purchase order `12247833`
- confidence 0.995
- source moved REVIEW -> processed
- source extraction_source `pdf_attachment`
- exactly one Purchase source link.

Document:
- id `52f22f74-460b-4cbe-a975-caedb25b6463`
- Purchase `dfbe41c3-89f0-4f10-8dc8-e34923fba130`
- invoice `S26_044783`
- source_type `email_attachment`
- exact provider message + attachment id + filename + MIME recorded
- private bucket/path + SHA-256 recorded.

Purchase integrity remained unchanged:
- Jatekbolt order `12247833`
- 48,245 HUF
- state delivered
- ordered `2026-08-02 16:49:02+00`
- shipped `2026-08-04 08:36:08+00`
- delivered `2026-08-05 05:54:33+00`.

Other PDFs encountered in the first live pass without enough explicit invoice/order identity stayed attachment REVIEW with `invoice_identity_not_found`; none were auto-linked.

### PR #89 — least privilege

Production grant inspection showed `service_role` inherited technical privileges beyond CRUD on `email_attachments`.
- PR #89 adds an explicit revoke-all then grants only SELECT/INSERT/UPDATE/DELETE.
- PR CI #455 passed.
- migration-only main `188340e1121fdaab6c64335f9214fa5b7d10fa1c`.
- main CI #456 passed.
- production grant check now shows exactly CRUD for `service_role`; no anon/authenticated grant.

### Current counters after PDF recovery

- source REVIEW 34
- source unlinked 10
- source unresolved total 44
- historical AI runs 98
- latest AI run `2026-08-14 21:43:08.694227+00`.

---

## 2026-08-15 — Jatekbolt + AlzaBox recovery

### Jatekbolt `12247833`

- Blind-test backlog contained a real Jatekbolt Purchase whose financial fields were missing even though the original merchant email had full structured totals.
- Verified exactly one live Purchase `dfbe41c3-89f0-4f10-8dc8-e34923fba130` and exactly one delivered DPD Shipment, tracking `16380124260518`.
- Added PR #84 `jatekbolt-order-received-v1`: exact `jatekbolt.hu`, matching subject/body order id, explicit offer-received/not-confirmed-yet wording, structured order section, and exact arithmetic reconciliation.
- Extracted subtotal 52,775 HUF + DPD 750 - discount 5,280 = total 48,245 HUF; Klarna; DPD; Model & Hobby Kft.; confidence 0.995.
- Runtime `c00cd8fff02f844ad9938d99df123ed732930148`; main CI #441 and exact Render smoke #335 passed.
- Live targeted rerun enriched the same Purchase without changing delivered lifecycle state.

### Alza `602385238`

- Three trusted Alza lifecycle emails existed with no Purchase: processing, delayed and AlzaBox ready-for-pickup.
- Rich processing evidence: exact order/reference, explicit no-contract-yet wording, two agreeing totals 3,350 HUF, invoice identity `AHUW261747843`, AlzaBox, card pickup/online, Alza.hu Kft.
- PR #85 added `alza-order-processing-v2` + strict internal fulfillment recovery gated by completed 90-day exact-order proof and separate lifecycle corroboration.
- PR #86 fixed processed-anchor eligibility and DB identity mapping after live verification found a safe false negative.
- Final runtime before PDF work `8b4461ce836c1e1e9e1f0c0813779fdcda3acbbe`; exact Render smoke #341 passed.
- Final live Purchase: exactly 1 Purchase, 0 Shipments, 3,350 HUF, `ready_for_pickup`, no invented ordered/shipped/delivered date, three linked sources, AI 0.
