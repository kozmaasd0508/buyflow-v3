# BuyFlow V3 — latest recovery worklog

> Newest detailed entries. Read this after `BUYFLOW_HANDOFF.md`; older historical entries remain in `BUYFLOW_WORKLOG.md` and Git history.

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
