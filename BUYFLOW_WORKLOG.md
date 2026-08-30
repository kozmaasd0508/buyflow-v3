# BuyFlow V3 — persistent worklog

> Concise newest-first history. `BUYFLOW_HANDOFF.md` is the current-state snapshot; older granular detail remains available in Git history.

## 2026-08-30 — Modern email source foundation v1 started

- New branch `codex/modern-email-source-foundation-v1` was created from the active V9 identity-shadow head `2e05b435a9f4fbc6467477c02fac462004bfa183`; no change was made directly on the V9 branch.
- Added `NormalizedEmailDocumentV1` as an additive contract with plain-text + HTML bodies, headers, attachments, structured-data records, extracted links, DKIM/SPF/DMARC verdict slots, immutable raw-source reference, normalizer version and cross-pipeline trace id.
- Added a backwards-compatible `upgradeNormalizedEmailToDocumentV1(...)` adapter. Missing evidence is kept `null`/`unknown`/empty and is never invented.
- Added `IncrementalEmailProvider` as a capability contract for durable provider sync. Gmail can map it to `watch + historyId/history.list`; Outlook can later map it to change notifications + delta cursors. Existing `EmailProvider` runtime behavior is unchanged.
- Added additive migration `20260830203000_add_modern_email_source_foundation.sql` for raw object key, SHA-256, byte size, content type, retention boundary, normalized object key, normalizer version and trace id on `source_emails`. Raw message bytes remain out of Postgres; the migration stores only object references/integrity metadata.
- Added adapter regression tests covering fail-closed defaults and provenance preservation.
- Safety: no provider runtime cutover, no Gmail/Outlook write, no Purchase/Shipment/Identity decision change, no AI authority change, no production database migration applied, no production writes.
- Verification is not yet claimed. Next gate: draft PR -> API typecheck/tests/build -> mobile typecheck/build. After green CI, implement the actual immutable raw-object writer + normalizer behind shadow/read-only wiring.

## 2026-08-23 — TechnicalEvidence Blind Holdout v1 freeze

- TechnicalEvidence candidate logic is frozen at commit `df221aa42856179c3c1b0b9e94d5d364b4ac7048`, timestamp/cutoff `2026-08-23T21:58:12Z` (`2026-08-23 23:58:12 Europe/Budapest`).
- Added `protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V1-2026-08-23.md` after the candidate freeze; protocol/evaluation-only changes do not alter the frozen evidence logic.
- Only messages received strictly after the cutoff may enter the first TechnicalEvidence Blind Holdout v1. Selection is mailbox-first and parser-blind; TechnicalEvidence/Extraction v2/legacy/Identity Graph/AI output cannot be used to select cases.
- Immediate Gmail ID-only preflight after the cutoff returned **0 eligible messages**. No candidate subject/body/raw MIME was inspected. The cutoff was NOT moved backward to manufacture a sample.
- No TechnicalEvidence extractor/provider/PDF/carrier/Shopify rule may change before the first frozen blind prediction. If evidence logic changes, the blind set must version forward.
- Ground truth must be annotated from source content before TechnicalEvidence predictions are viewed. Repo-safe bundles may contain only opaque case ids + GT states/values; raw Gmail identifiers/content stay private.
- Blind gate explicitly treats unsafe identity authority as critical: untyped `id/ids/code/ref`, Shopify fingerprint-only lifecycle, future shipment as current state, pre-advice as physical shipment, QR pickup code as tracking, carrier-less tracking hard merge, or contradictory hard ids merged instead of REVIEW.
- Current state remains shadow-only: 0 production writes, 0 AI, no production parser/DB/Identity Graph cutover.

## 2026-08-23 — TechnicalEvidence v1.4/v1.5 deep-layer expansion

- PR #256 remains open on `codex/technical-evidence-shadow-v1`; production parser, DB and Purchase Identity Graph decision authority remain untouched. Shadow invariants remain 0 writes / 0 AI.
- v1.4 added deterministic PDF invoice evidence, authenticated DPD lifecycle/parcel semantics, authenticated FOXPOST lifecycle/dual-id semantics, provider-qualified GLS COD receipt PDF evidence, and QR preflight.
- Same ten-family development slice progressed from v1.2 commerce/event/hard-id **6/10 / 3/10 / 4/10** to v1.4 **9/10 / 6/10 / 7/10**. Extended with GLS COD receipt: **10/11 / 7/11 / 8/11**.
- FOXPOST QR preflight proved the QR payload is pickup/opening code, not parcel identity; generic QR-to-tracking extraction is explicitly rejected.
- Shopify preflight found two independent native Shopify order-confirmation merchant families with the same transport + transactional DOM + explicit order-reference stack. Added `technical-evidence-shopify-v1.ts` and fail-closed regressions.
- Shopify v1.5 requires native `mailer.shopify.com` relay + independent Shopify auth/message evidence + standard transactional order DOM + explicit current-message order id. Shopify CDN/CSS alone, merchant custom/SES mail, and Shopify account/security mail grant no lifecycle authority.
- Order confirmation now has two-independent-merchant evidence. Native shipment/delivery is retained with a narrower one-independent-lifecycle-family qualifier. Shopify tracking stays without carrier namespace and cannot hard-merge until carrier namespace is independently resolved.
- Development projection on the same original ten families is now commerce-specific **10/10**, explicit event **7/10**, merchant-scoped/namespaced identifier **8/10**. Extended 11-family slice: **11/11 / 8/11 / 9/11**. These are development coverage figures, not blind accuracy/precision/recall.
- Report: `protocols/TECHNICAL-EVIDENCE-SHOPIFY-DEVELOPMENT-PREFLIGHT-2026-08-23.md`.
- Full repository CI/typecheck has NOT been claimed for this non-main-targeting PR. Next unbiased gate is a completely fresh frozen holdout before any further tuning or production authority.

## 2026-08-23 — TechnicalEvidence v1.1/v1.2 broad development measurement

- PR #256 remains open and mergeable on `codex/technical-evidence-shadow-v1`; still shadow-only, 0 production writes, 0 AI, no runtime/DB/Identity Graph wiring.
- Same six already-reviewed Gmail cases: v1 -> v1.1 commerce-specific technical coverage **3/6 -> 6/6**, explicit event **2/6 -> 6/6**, hard identifier **1/6 -> 3/6**. v1.1 added exact composite template tags plus strict current-message English machine labels/lifecycle semantics.
- Broader ten-case development slice covers WooCommerce, UNAS, Shopify, GLS, MPL, FOXPOST, DPD, Billingo, Számlázz.hu and merchant-invoice/PDF families. v1.1 broad result: commerce-specific **3/10**, event **2/10**, hard identifier **1/10**.
- v1.2 added audited platform/provider semantics without weakening global matching: WooCommerce multi-primitive order identity, UNAS exact generator-action discrimination, Shopify multi-signal platform fingerprint, official Posta tracking `ids` alias, and dedicated `X-Szamlazz-Invoice` evidence.
- Broad v1.2 development remeasurement: commerce-specific **6/10**, explicit event **3/10**, hard identifier **4/10**; auth/transport remains 10/10. These are development coverage figures, not blind accuracy claims.
- Safety regressions explicitly reject generic `ID`, `Reference`, `ids`, `code` and `ref` interpretations outside typed/provider-qualified contexts; Shopify platform evidence grants no lifecycle authority; WooCommerce order table grants identity but no event authority.
- Remaining high-value technical gaps: FOXPOST dual-id/QR/redirect semantics, DPD authenticated template semantics, PDF TechnicalEvidence, and only then stronger Shopify notification-type discrimination if stable machine evidence is proven.
- Measurement docs: `protocols/TECHNICAL-EVIDENCE-REAL-GMAIL-MEASUREMENT-V11-2026-08-23.md`, `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V11-2026-08-23.md`, `protocols/TECHNICAL-EVIDENCE-BROAD-DEVELOPMENT-MEASUREMENT-V12-2026-08-23.md`.

## 2026-08-23 — TechnicalEvidence v1 Real Gmail development measurement

- PR #256 gained a privacy-safe side-by-side measurement harness: `technical-evidence-real-gmail-measurement-v1.ts` plus regression coverage.
- Six already-reviewed RAW Gmail development cases were preflighted: Sportvision order, GymBeam sent/invoice, Express One processing/out-for-delivery/delivered.
- Current TechnicalEvidence v1 result: auth/transport evidence 6/6, commerce-specific technical evidence 3/6, hard identifier evidence 1/6, explicit event evidence 2/6, explicit tracking evidence 1/6, JSON-LD 0/6 in this slice.
- Positive signals: Sportvision HTML title -> order event; Express One delivered `trackingNr` URL -> tracking identity; GymBeam invoice HTML title -> invoice event.
- Measurement exposed generic gaps before any cutover: composite `order-sent` / `order-invoice` provider tags are not fully mapped, and alternate English machine semantics (`shipment ID`, `air waybill`, delivery lifecycle wording) are not yet parsed.
- Conclusion: provenance architecture is useful but v1 is not broad enough to claim recall improvement. Keep shadow-only; next step is TechnicalEvidence v1.1 machine-semantic expansion and rerun against the same development GT.
- Detailed report: `protocols/TECHNICAL-EVIDENCE-REAL-GMAIL-MEASUREMENT-V1-2026-08-23.md`.
- Safety unchanged: 0 AI, 0 production writes, no DB migration, no production parser/Identity Graph cutover, no raw private email values in repo outputs.

## 2026-08-23 — TechnicalEvidence v1 multi-layer shadow foundation

- PR #256 opened from `codex/technical-evidence-shadow-v1` onto `codex/mailgun-inbound-shadow-v3`.
- Added a separate TechnicalEvidence v1 observational lane with exact field-level provenance (`source`, `sourcePath`, extractor id/version, confidence, qualifiers) without changing the frozen Extraction Engine v2 or Purchase Identity Graph v2.
- First extractor families: semantic headers/authentication headers, URL query/path identifiers, HTML title/class/id/data/alternate-text semantics, and JSON-LD/schema.org fields.
- Added privacy-reduced summary output; raw TechnicalEvidence is explicitly not for persistence/logging.
- Regressions cover independent multi-layer evidence for order identity/event, invoice header, tracking URL, WooCommerce fingerprint, carrier alt text, JSON-LD merchant/product/amount/currency, malformed JSON/URL fail-safe behavior, input immutability, 0 writes and 0 AI.
- Isolated strict TypeScript (`strict + noUncheckedIndexedAccess`) compile PASS and isolated runtime smoke PASS. Full repo CI has not run because the repository CI workflow triggers only for `main` pushes/PRs.
- PR #256 is mergeable. No DB migration, no runtime wiring, no production parser change, no automatic identity/merge authority.

## 2026-08-20 — Frozen v6 blind holdout and scoped provider fixes

- Gmail v6 holdout frozen before audit implementation: 50 commerce + 50 hard noise; prior v4/v5 labels excluded.
- PR #190 added the label-locked `/audit-v6` harness without changing the detector/parser engine.
- First blind result: 100/100 coverage, TP 42 / FN 8 / FP 0 / TN 50, precision 100%, recall 84%, 0 production writes, 0 AI calls.
- The eight misses were limited to Express One receipts, Google Play subscription lifecycle, MPL/Posta out-for-delivery (direct and Allegro relay), and Shopbuilder shipping.
- PR #191 added five provider-scoped rules requiring exact sender/domain plus explicit lifecycle evidence, with positive and fail-closed negative tests. Frozen fixtures and broad generic matching were unchanged.
- Exact merged shadow head and live Render commit: `2f8e3e2d39c8e9e94fce9cf671a47d0e401a48ce`.
- Live v6 regression: **TP 50 / FN 0 / FP 0 / TN 50**, precision 100%, recall 100%, 100/100 coverage, 0 writes, 0 AI.
- GitHub Actions did not publish checks for PRs #190/#191; exact Render commit verification plus the read-only audit are recorded.
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

## Maintenance format

After meaningful work prepend a concise entry with:
- PR/commit and CI/deploy proof,
- changed behavior,
- live verification/data writes,
- safety notes,
- remaining backlog/next architecture gap.

Never store secrets, credentials or raw customer email bodies here.
