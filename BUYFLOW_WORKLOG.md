# BuyFlow V3 — persistent worklog

> Append concise newest-first entries after meaningful work. Keep `BUYFLOW_HANDOFF.md` as the current-state snapshot.

## 2026-08-15 — Multi-Gmail + full 30-day deterministic scan UI

- PR #69 / main runtime `afa01c0d21179dc6472b7e32d427c789282d34ea`: Gmail settings now lists every active Nylas/Gmail connection and exposes `+ Másik Gmail hozzáadása`.
- Added per-account 7 / 30 / 90 day full-inbox scan controls; 30 days is the recommended cross-account blind-test window.
- The scan uses the existing deterministic write-mode pipeline, not the old AI benchmark; recognition/parser/resolver rules were not weakened and uncertain evidence remains REVIEW.
- UI shows checked, processed, review, unlinked, Purchase writes, Shipment writes, Document writes and AI call count per latest scan.
- API `/api/email-connections/:id/initial-scan` now accepts only 7/30/90 day windows and returns job id/status/window; newly connected Gmail still gets the automatic 7-day initial scan.
- PR #69 CI #408 and main CI #409 passed.
- PR #70 / main runtime `5fdf20f69dc4f3518d36400223f7a522f124de79`: fixed repeated same-window scan progress so the UI follows the newly enqueued job instead of prematurely reading the previous completed result. PR CI #410 and main CI #411 passed.
- PR #71 / main `44fa37bd89b268049230dcb45e86920ac93d3cc0`: upgraded Render health diagnostic to prove that the deployed commit contains the latest runtime-changing commit.
- Exact production diagnostic run #4: expected runtime `5fdf20f69dc4f3518d36400223f7a522f124de79`, deployed Render commit exactly the same, `runtime_deployment_verified=true`, version 0.4.0, automation mode write.
- No APK built. Next user-facing step: connect a second Gmail in the browser, let automatic 7-day scan finish, then run the 30-day full-inbox scan and score real found/missed/false/review/duplicate outcomes.

## 2026-08-15 — Scitec / BioTechUSA / Foxpost deterministic completion

- PR #65 / main `053d4e1190b6bc8fd35f1c00932508c7b473dc8c`: generic order parser v1.2 now accepts safe Hungarian `Rendelés: #...` identities and the real `Köszönjük megrendelésedet` confirmation form; stale #58 closed as superseded.
- Live Scitec `1783-975-87-395`: 1 checked / 1 processed / 1 Purchase write / 0 review / 0 unlinked / AI 0; total 16,780 HUF, confidence 0.95.
- PR #66 / main `3d73da6a1e42410955d28bca1e54024538c0b092`: narrow verified-brand COD carrier fallback for explicit `scitec.hu` + BioTechUSA Kft. + Foxpost identity. Requires >=2 carrier sources, exact COD+currency, <=7 days, confidence >=0.95 and one Purchase candidate; generic carrier-only guessing remains blocked.
- Live tracking `CLFOX178401889449819` linked to exactly one Scitec Purchase/Shipment and advanced to `ready_for_pickup`; no delivered state.
- PR #67 / main runtime `ce759ed001c6f52dcb84cf2b56f431d3da2972ab`: Foxpost parser v1.1 accepts the trusted generic `Csomagod azonosítószáma: CLFOX...` label used by the warehouse-arrival email; strict Foxpost sender, parcel-sender and lifecycle gates remain.
- PR #65, #66, #67 PR CI and main CI passed; #67 main CI was #405.
- Final live tracking rerun: 3 checked / 3 processed / 0 review / 0 unlinked / AI 0. All three Foxpost stages are linked to the same Purchase.
- Final Shipment status `ready_for_pickup`; `shipped_at=2026-07-14 17:33:28+00` from first explicit physical warehouse arrival; `last_event_at=2026-07-15 09:55:07+00`; delivered_at null.
- Historical AI run count remains 98. Live unresolved counts after completion: review 28, unlinked 13.
- Literal exact Render `/health` commit-SHA verification remains unavailable in the current tool environment; functional live worker behavior proves the new logic is active but exact SHA smoke is still a separate check.

## 2026-08-15 — Gate.shop / Foxpost ready-for-pickup completion

- PR #62 merged to main as `0505fe96c872f7d6bd20c775838305035ba08b45`.
- Main CI run #395 passed.
- `ready_for_pickup` now survives the carrier parcel-sender bridge and is supported by controlled shipment creation.
- State precedence is monotonic: delivered > ready_for_pickup > in_transit; weaker later evidence cannot downgrade pickup-ready.
- Controlled shipment SECURITY DEFINER path/execute rights were hardened in the deployed migration.
- Live targeted recovery for `Z3493891717`: 2 checked, 2 processed, 0 review, 0 unlinked, AI 0.
- Gate.shop order `20336215` now has Purchase `current_state=ready_for_pickup` and one Foxpost shipment with tracking `CLFOX178524111362058`, status `ready_for_pickup`.
- Historical AI run count stayed 98; latest AI run remains 2026-08-14 21:43:08.694227+00.
- Literal exact Render `/health` commit-SHA verification could not be fetched from the current tool environment; behavioral live verification passed, exact SHA smoke remains to be checked separately.
- Live unresolved counts after rerun: review 29, unlinked 14; one older 2026-07-15 Foxpost source remains unlinked and is separate from Gate.shop.

## 2026-08-15 — Ars Una / GLS deterministic carrier bridge

- PR #56 / main commit: `35dd96f1678c4bba74ecc973288cfb0f1df1dc43`.
- Added `gls-lifecycle-v1` and `carrier-sender-cod-bridge-v1`.
- Exact GLS sender only; extracts parcel sender, tracking and COD.
- Pre-advice stays `shipment_created`; delivery-today stays `out_for_delivery`; dynamic GLS RTT URL is `in_transit`; no delivered state without completion evidence.
- Carrier→Purchase bridge requires one existing COD Purchase, exact normalized merchant/parcel-sender identity, GLS compatibility, <=1 currency-unit amount difference, 14-day window, and one already-linked merchant shipment source without tracking.
- Verified Ars Una order `192132` invoice `5133964`: product 6,276 HUF + shipping 1,990 HUF = 8,266 HUF, payment Utánvét.
- GLS states COD 8,265 HUF; explicitly treated as a 1 HUF difference, not exact equality.
- Live tracking `3412614699`; exactly one GLS shipment created; current state `in_transit`.
- Corrected historical shipment timestamp after all old AI evidence was reparsed: pre-advice no longer counts as shipped; first physical progress is the delivery-today evidence.
- Dynamic tracking email was recovered from the GLS RTT URL and linked.
- Final unresolved GLS rows: 0. AI 0.
- PR CI, main CI and exact Render smoke passed.

## 2026-08-15 — Allegro / HappyBox24 lifecycle and seller invoice

- PR #54 / main `012b80e0273ce18bcc252e0a076ce1a566f4cccd`: added `allegro-lifecycle-v1`.
- Allegro merchant mail uses exact purchase-history UUID + carrier tracking; DPD relay messages never invent order IDs.
- `delivery today` remains out_for_delivery; only explicit successful completion becomes delivered.
- HappyBox24 Purchase UUID `3fe09c80-8d79-11f1-b193-cf13a29b46f5` now has exactly one DPD shipment, tracking `13169408547018`, with five lifecycle sources processed/linked.
- PR #55 / main `1f8c19d4dcf1ca80f09cc10a99946d4a836fd8ea`: added `allegro-sales-document-v1` so document identity wins over incidental “package arrived” wording.
- Verified seller invoice:
  - invoice `I/00005/08/26`
  - seller internal order `46181083`
  - total 5,675 HUF
  - shipping 1,990 HUF
  - product prices 1,830 + 1,855 HUF
  - exactly 1 invoice document linked to HappyBox24 Purchase.
- AI 0; CI/main CI/exact Render smoke passed.

## 2026-08-15 — Promotional / repurchase hard-negative

- PR #53 / main `6ba285ac7a8c975eb7807b07b2253fc181c8a210`.
- Added conservative promotional/repurchase exclusion without using Gmail Promotions as a hard gate.
- Explicit order/tracking/invoice identity and real order-confirmation wording override the marketing exclusion.
- Cleaned four verified false commerce rows (Goddess/Galaxy/Sport8 patterns) after confirming zero Purchase links; previous machine results preserved for audit.
- BF synthetic Gmail examples remain review intentionally.
- AI 0; CI/main CI/exact Render smoke passed.

## 2026-08-15 — Barion payment-only safety check

- Inspected three unlinked successful Barion payments (two Netfone, one InnVoice).
- No corresponding Purchase/order/invoice was found in the current database or mailbox search window.
- Kept them unlinked: successful payment evidence alone cannot create a Purchase.
- This is intentional safe behavior, not a forced-recovery failure.

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
