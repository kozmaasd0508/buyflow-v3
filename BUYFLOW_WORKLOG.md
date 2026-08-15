# BuyFlow V3 — persistent worklog

> Append concise newest-first entries after meaningful work. Keep `BUYFLOW_HANDOFF.md` as the current-state snapshot.

## 2026-08-15 — Express One terminal receipt resolver

- PR #51 / main commit: `20ad2db45df68a1dd9d7e97f64fcc1401bd3b850`.
- Added `expressone-terminal-receipt-v1` for successful card-terminal receipts from exact sender `slip@expressone.hu`.
- A receipt can only update an existing COD/Utánvét Purchase when amount, currency, Express One identity, shipment event time and single-candidate checks all agree.
- Zero or multiple candidates => REVIEW; receipt is never eligible for Purchase creation.
- Live links: 9,450 HUF -> GymBeam `3010206178`; 13,240 HUF -> GymBeam `3010228912`.
- Both Purchases now have `payment_status=paid` and receipt timestamps.
- Live webhook replay of the 9,450 HUF receipt returned `processed/validated`, parser `expressone-terminal-receipt-v1`, exactly one Purchase link, AI 0.
- PR CI, main CI and exact Render smoke passed.

## 2026-08-15 — GymBeam processing parser v1.1

- PR #49 added trusted GymBeam order-processing parsing; PR #50 added the real Nylas flattened-table format.
- Current parser: `gymbeam-order-processing-v1.1`.
- Emits lifecycle `order_processing` / event `order_updated`, never `order_created`.
- Requires trusted sender, explicit processing language/order identity, structured product evidence and money reconciliation.
- Live verification AI 0:
  - `3010206178`: 9,450 HUF, COD, Express One, 4 products.
  - `3010228912`: 13,240 HUF, COD, Express One, 5 products.
- Existing Purchases were enriched with subtotal, shipping, total, payment method, carrier and product rows.
- PR #50 main commit: `e97d048cf1f8b3585eb4d5dff86a4f477f2fffff`; exact Render smoke passed.

## 2026-08-15 — Strict reconstruction of missing GymBeam `3010085026`

- Found while resolving the remaining Express One review/unlinked rows.
- Exact 90-day order search showed no `order_created` email.
- Corroborating evidence: GymBeam processing summary + GymBeam merchant shipment + GymBeam invoice + three Express One lifecycle emails sharing exact tracking identity.
- Reconstructed exactly one Purchase: total 17,270 HUF; product subtotal 15,780; shipping 1,190; COD fee 300; payment Utánvéttel; Express One.
- Tracking: `605855680768000013605231`.
- Invoice: `4008742640`.
- 11 products inserted from the verified processing summary.
- Final verification: 1 Purchase, 1 shipment, 1 invoice, 11 products, no duplicates.
- AI 0.

## 2026-08-15 — Express One outbound pickup noise cleanup

- PR #47 / main commit: `2bac53d5550236023824b08cbefc9fd8a708652c`.
- Root cause: Express One WEBCAS courier-pickup bookings use purchase-like wording (`megrendelés`), causing old review/unlinked rows to look like consumer purchases or shipments.
- Added a narrow exclusion requiring Express One sender plus strong outbound `árufelvétel` / `request_curier` evidence.
- Regression tests verify that real incoming Express One parcel/delivery mail is not excluded.
- Removed temporary Allegro fallback diagnostics from PR #44.
- PR CI, main CI and exact Render smoke passed.
- Live cleanup: 43 unresolved Express One pickup-service rows -> 0; 5 false `order_created` + 38 false `shipment`; 0 Purchase links before cleanup.
- Old wrong machine result is retained inside the cleanup JSON for audit; source emails were not deleted.
- AI counter stayed at 98; no new AI call.

## 2026-08-15 — Persistent handoff system

- Added root `AGENTS.md` with mandatory startup/shutdown instructions for future AI sessions.
- Added `BUYFLOW_HANDOFF.md` as the rolling current-state source.
- Added this append-style worklog.
- Goal: a new chat should be able to continue from GitHub without the user retelling project history.

## 2026-08-15 — Allegro / HappyBox24 deterministic recovery

- Real Allegro purchase from seller `HappyBox24` initially fell through to the AI-off fallback.
- Hardened Allegro recognition across flattened HTML/text and Hungarian money spacing.
- Final live deterministic parse: `allegro-order-v1.4`, `order_created`, confidence 0.995.
- Correct values verified live: total 5,675 HUF, shipping 1,990 HUF, products 1,830 HUF and 1,855 HUF, cash on delivery, DPD.
- Existing Purchase and product rows reflect the corrected values.
- AI calls remained unchanged at 98 during final deterministic verification.
- Alza `602385238` lifecycle chain did not create a false Purchase.

## 2026-08-15 — PR #44 safe Allegro diagnostics

- Merge commit: `1bef49b47c6a8d3168d1002c373c540a80cd3911`.
- Added safe temporary diagnostics only for unmatched Allegro email fallback.
- Diagnostics record lengths and boolean signal presence, never email body content.
- Main CI and exact Render smoke passed.
- Follow-up completed in PR #47: temporary diagnostics removed after real HappyBox24 deterministic recognition stabilized.

## 2026-08-15 — PR #43 long deterministic email support

- Merge commit: `dadd19d67374f6621e91dc516522587a47389423`.
- Deterministic Nylas parser visibility raised from 20k to 80k compacted characters.
- Added regression test for order evidence located after old 20k cutoff.
- Existing safety gates unchanged.
- PR CI, main CI and exact Render smoke passed.

## 2026-08-14/15 — Frontend catch-up V1

- Merge commit: `1895ce54f9def646719339d97bac88685677f326`.
- Activated existing product detail/edit/remove and targeted recovery modules.
- Added purchase detail current-state/next-action panel.
- Added Gmail settings sheet.
- Browser preview verified live after exact Render smoke.
- Later AI-off UI removed active AI audit/Flow surfaces while deterministic recognition is developed.
- Remaining frontend gaps: Warranty, Return/Refund and Felfedezés; Flow stays hidden while AI is off.
- Browser-first rule reaffirmed: no APK after small changes.

## 2026-08-14 — Auth reset hardening

- Merge commit: `6bf190105b36170fb6ce15825eb4530553acb6a2`.
- Reset token removed from URL fragment immediately.
- Password policy: 12–128 chars with lowercase, uppercase, digit and special.
- Specific weak-password UI, noindex/noarchive behavior.
- Leaked-password protection was not toggled by connector; never claim it is enabled unless later verified.

## 2026-08-14 — Security DEFINER hardening

- Merge commit: `916fa354b35314afbeee71ffc43a573971c89cbf`.
- Hardened legacy SECURITY DEFINER search paths and execute rights.
- Service-only RLS INFO items intentionally left without broad user policies.

## 2026-08-14 — Corroborated Document Resolver V1

- Merge commit: `d56f88dbe36d234dc0ccffa8eed632f33d3d5ca5`.
- Created exactly two GymBeam invoice documents without duplicates or new AI calls:
  - order `3010228912` -> invoice `4008874007`
  - order `3010206178` -> invoice `4008874475`

## 2026-08-14 — Historical purchase reconstruction and tracking hardening

- Strict historical reconstruction created exactly two GymBeam purchases:
  - `3010206178`, confidence 0.90
  - `3010228912`, confidence 0.88
- A cross-linked tracking bug was found and corrected.
- Final tracking identities:
  - `3010206178` -> `605855685055000013605231`
  - `3010228912` -> `605855685836000013605231`
- Carrier semantic hardening prevents "delivery today" from becoming final delivered without completion wording.

## Maintenance format

For future entries use roughly:

```md
## YYYY-MM-DD — short title

- PR/commit: ...
- Changed: ...
- Live verification: ...
- Data writes: ...
- Safety notes: ...
- Remaining: ...
```

Do not paste raw customer emails, credentials, secrets, tokens or private personal data here.
