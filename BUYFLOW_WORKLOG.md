# BuyFlow V3 — persistent worklog

> Concise newest-first history. `BUYFLOW_HANDOFF.md` is the current-state snapshot; older granular detail remains available in Git history.

## 2026-08-20 — Frozen v6 blind holdout and scoped provider fixes

- Gmail v6 holdout frozen before audit implementation: 50 commerce + 50 hard noise; prior v4/v5 labels excluded.
- PR #190 added the label-locked `/audit-v6` harness without changing the detector/parser engine.
- First blind result: 100/100 coverage, TP 42 / FN 8 / FP 0 / TN 50, precision 100%, recall 84%, 0 production writes, 0 AI calls.
- The eight misses were limited to Express One receipts, Google Play subscription lifecycle, MPL/Posta out-for-delivery (direct and Allegro relay), and Shopbuilder shipping.
- PR #191 added five provider-scoped rules requiring exact sender/domain plus explicit lifecycle evidence, with positive and fail-closed negative tests. Frozen fixtures and broad generic matching were unchanged.
- Exact merged shadow head and live Render commit: `2f8e3e2d39c8e9e94fce9cf671a47d0e401a48ce`.
- Live v6 regression: **TP 50 / FN 0 / FP 0 / TN 50**, precision 100%, recall 100%, 100/100 coverage, 0 writes, 0 AI.
- GitHub Actions did not publish checks for PRs #190/#191; exact Render commit verification plus the read-only live audit are recorded.
- The v6 set is now regression evidence; use a newly frozen holdout for any next unbiased generalization gate.

## 2026-08-20 — Frozen v5 blind holdout and scoped provider fixes

- PR #187 added the Gmail-label-locked `/audit-v5` harness for a frozen 50 commerce + 50 hard-noise set; the detector was untouched before the first run.
- First blind result: 100/100 coverage, TP 40 / FN 10 / FP 3 / TN 47, precision 93%, recall 80%, 0 production writes, 0 AI calls.
- PR #188 added ten sender-domain + explicit lifecycle-evidence rules and three provider-scoped non-commerce guards. Broad generic matching and the frozen fixtures were unchanged.
- Local verification: API typecheck PASS and **864/864 tests PASS**.
- Exact merged shadow head: `6399522a6a806ebc39db8cbbb9cf80078e064c9b`.
- Live Render regression: **TP 50 / FN 0 / FP 0 / TN 50**, precision 100%, recall 100%, 100/100 coverage, 0 writes, 0 AI.
- The v5 set is now a regression set; use a new frozen holdout for the next unbiased generalization gate.

## 2026-08-17 — Unknown Merchant generic order v1.4

- PR #147 hardens `generic-order-confirmation-v1.4` from the real v1.3 mailbox findings: explicit contract/order-offer non-acceptance now blocks generic order creation, and recognized reply/forward quoted history cannot create a second `ORDER_CREATED` candidate.
- Quote stripping is scoped only to generic new-order evidence; full email remains available to merchant/lifecycle parsers. Reviewed JatekBolt merchant-specific order-received semantics remain separate.
- Permanent PR CI #609 passed **680/680 API tests**, API typecheck/build and mobile typecheck/build.
- Temporary read-only PR #148 reran the full rolling two-year Nylas audit over **9,438 messages**, then was closed **without merge**.
- Live before -> after: raw generic 12 -> 8; unprofiled 9 -> 5; distinct unprofiled families 7 -> 4; strong unprofiled 2 -> 0.
- Exact privacy-safe fingerprint comparison: Manna 2 -> 2, Scitec 1 -> 1, Zákány 1 -> 1, Vitál-Kolor 2 -> 1 (quoted reply removed, original retained); reviewed ABOUT YOU and both unsafe strong non-acceptance families disappeared.
- No DB writes, production registry use, automatic Purchase writes or protocol activation. Generic unknown-merchant order evidence remains REVIEW/shadow-only with `would_write=false`.
- Release gate: final PR #147 CI -> merge -> exact main CI -> exact Render smoke.

## 2026-08-15 — Gyerekjatekbolt failure/cancel + Szidibox/MPL recovery

- Reviewed the remaining second-Gmail REVIEW/unlinked backlog and prioritized real commerce clusters over obvious subscription/promo/noise.
- Gyerekjatekbolt order `535574` already had the correct deterministic lifecycle rules in current main. Targeted 30-day rerun: 5 checked / 4 processed / 1 REVIEW / 0 unlinked / 0 writes / AI 0.
- Final `535574`: `payment_status=failed`, `current_state=cancelled`, `cancelled_at=2026-08-04 11:21:36+00`, paid_at null, no Shipment. The standalone retry-payment-link email intentionally remains REVIEW.
- Inspected four real McDonald's payment-summary emails. Each uses a short 4-digit restaurant/POS order number and explicitly says the email is only an order summary; no separate receipt email was found. Because those IDs can repeat and current uniqueness is merchant-domain + order-number, the cluster remains REVIEW. Follow-up architecture: POS/local-order identity using location/time/provider identity rather than globally trusting the 4-digit number.
- Found Szidibox order `SO-2024-30411`: historical Purchase already existed but incorrectly used `merchant_domain=gmail.com`; merchant sends from `szidibox@gmail.com`, message contains `kartonshop.hu`, and MPL carrier chain uses tracking `PB9S650307180`.
- PR #80 / main `3d53c3cefb61d9c2452cb9f677214fc32c0cf22d`: added deterministic MPL lifecycle and public-mailbox safety. Exact `kozponti.ertesites@posta.hu`; shipped/out-for-delivery/ready-for-pickup states; tracking/parcel-sender/COD extraction; MPL slug normalization; narrow Szidibox packing anchor as `shipment_created`; generic public-mailbox Purchase creation now stays REVIEW. PR CI #429, main CI #430, exact Render smoke #324 passed.
- First live Szidibox rerun correctly reparsed merchant packing as `shipment_created`, but exposed two real gaps: carrier bridge used the packing timestamp as physical `shipped_at`, and Nylas flattened MPL labels prevented the new parser from replacing legacy carrier results.
- PR #81 / main `5139fda8bcad1f743aef37b49340bef93ca446e4`: `shipment_created` anchors can no longer define physical shipped time; first physical carrier event does. MPL parser now handles line-oriented and flattened Nylas text. PR CI #433, main CI #434, exact Render smoke #328 passed.
- Final MPL targeted rerun: 3 checked / 3 processed / 0 REVIEW / 0 unlinked / AI 0. All three carrier sources now use `deterministic-lifecycle-v1`, confidence 0.995, COD 26,390 HUF, parcel sender Szidibox Karton Kft.; phases `shipped -> out_for_delivery -> ready_for_pickup`.
- PR #82 / main `e320ac5593f95f6535c97b865f569c9d7bbde181`: canonicalized bridged MPL display name from raw `mpl` to `MPL`. PR CI #435, main CI #436, exact Render smoke #330 passed.
- Guarded historical repair updated exactly one Purchase and one Shipment. Final Purchase `24b05d2e-be2c-4ea8-9836-befce30b4ddd`: merchant domain `kartonshop.hu`, legal name Szidibox Karton Kft., 26,388 HUF COD, expected carrier MPL, state `ready_for_pickup`, shipped_at `2026-07-23 14:44:56+00`, delivered_at null.
- Final Shipment `f6ed4ca1-7750-4d48-99ee-3ece45a5213c`: MPL / `mpl`, tracking `PB9S650307180`, `ready_for_pickup`, shipped_at `2026-07-23 14:44:56+00`, last_event_at `2026-07-24 11:46:49+00`, delivered_at null, 4 shipment source links.
- Integrity: exactly 1 Purchase and 1 Shipment for this identity. Historical AI count remains 98; no new AI calls. Backlog reduced to **35 REVIEW + 13 unlinked**.
- Safety follow-up: new unverified Gmail/Outlook/Yahoo merchant evidence cannot create a Purchase. A future verified public-mailbox merchant identity layer is still needed before legitimate public-mailbox merchants can auto-create new Purchases; until then REVIEW is intentional.

## 2026-08-15 — Second Gmail blind test + All In Packaging historical recovery

- PRs #73–#76 completed second-Gmail OAuth and repeat 7/30/90 scan reliability.
- Second Gmail 7-day scan: 34 checked / 30 ignored / 4 REVIEW / 0 unlinked / AI 0.
- Real 30-day blind scan: 149 checked / 130 ignored / 14 REVIEW / 5 unlinked / 0 Purchase / 0 Shipment / 0 Document writes / AI 0; zero false automatic Purchases.
- All In Packaging order `148810` exposed a real false negative with merchant dispatch + merchant invoice + GLS chain but no order-created mail.
- PR #77 was closed unmerged after CI exposed a safety issue; existing stricter historical architecture was used instead.
- PR #78 / runtime `ebe06d3ee8c6c203bc363ed58eb992670758f667`: extended strict 90-day historical reconstruction for carrier-only tracking with merchant/domain anchors, exact negative proof, multi-event carrier corroboration, parcel sender, COD+currency and uniqueness checks.
- Live `148810`: exactly 1 Purchase (16,670 HUF COD, GLS) and 1 Shipment tracking `3219379224`; second no-COD GLS tracking `3219379250` remains unlinked. AI 0.

## 2026-08-15 — Multi-Gmail + deterministic scan UI

- PR #69 added all connected Gmail accounts and per-account 7/30/90 full deterministic scans.
- PR #70 fixed repeated same-window UI polling.
- PR #71 added exact Render deployment ancestry verification.
- PR #75 repaired server-only OAuth-state DB grants; PR #76 repaired repeat scan enqueue/reset semantics.
- Browser-first remains the project rule; no APK for routine backend/UI changes.

## 2026-08-15 — Key deterministic recognition milestones

- Gate.shop / Foxpost: ready-for-pickup lifecycle and exact carrier bridge.
- Scitec / BioTechUSA / Foxpost: generic Hungarian confirmation + verified legal-entity COD bridge + Foxpost lifecycle.
- Ars Una / GLS: exact sender, parcel sender + COD bridge, correct physical shipment semantics.
- Allegro / HappyBox24: order lifecycle, DPD tracking and seller invoice.
- GymBeam / Express One: processing enrichment, strict missing-purchase reconstruction, terminal receipt payment resolution and outbound pickup-noise exclusion.
- Promotional/repurchase hard negatives and Limone deterministic merchant parsing remain active.
- Three Barion payment-only rows intentionally remain unlinked without merchant corroboration.

## 2026-08-14/15 — Foundation / security / frontend

- Persistent `AGENTS.md`, `BUYFLOW_HANDOFF.md`, `BUYFLOW_WORKLOG.md` allow new chats to continue from GitHub.
- Auth reset and SECURITY DEFINER hardening completed.
- Browser frontend supports purchase list/detail, current state/next action, timeline, product edit/remove, order/tracking/documents, targeted recovery and multi-Gmail scans.
- AI/Flow audit UI stays hidden while AI is disabled.
- Remaining UI gaps: top-level lifecycle label/count alignment, Warranty, Return/refund, Felfedezés.

## Maintenance format

After meaningful work prepend a concise entry with:
- PR/commit and CI/deploy proof,
- changed behavior,
- live verification/data writes,
- safety notes,
- remaining backlog/next architecture gap.

Never store secrets, credentials or raw customer email bodies here.
