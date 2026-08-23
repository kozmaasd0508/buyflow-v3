# BuyFlow V3 — persistent worklog

> Concise newest-first history. `BUYFLOW_HANDOFF.md` is the current-state snapshot; older granular detail remains available in Git history.

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

## Maintenance format

After meaningful work prepend a concise entry with:
- PR/commit and CI/deploy proof,
- changed behavior,
- live verification/data writes,
- safety notes,
- remaining backlog/next architecture gap.

Never store secrets, credentials or raw customer email bodies here.
