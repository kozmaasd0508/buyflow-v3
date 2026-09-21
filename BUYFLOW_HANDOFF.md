# BuyFlow V3 — current handoff

Updated: 2026-09-20. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; reconcile against GitHub main and exact deployment evidence before acting.

## Verified runtime

- Repository: kozmaasd0508/buyflow-v3. Latest verified runtime is PR #333, main `2638ee1d93d12ef74443f0eb687137af4639555c`.
- PR #333 final CI #35531231754, main CI #35531391000 and exact Render smoke #35531437379 SUCCESS; API/mobile typecheck, tests/builds and database/crash-recovery gates are green.
- The Render smoke verified the exact main commit through /health and the browser preview, plus auth, CORS and Nylas webhook guards.
- PR #333 Luna-first selective Sol verification, PR #331 Luna logistics-boundary prompt, PR #329 MailLens evidence envelope, PR #326 Luna evidence prompt and PR #324 MailLens v2 are incorporated.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.
- TypeScript API/mobile, Supabase, Nylas; primary runtime model pinned to gpt-5.6-luna with selective gpt-5.6-sol verification. AI remains observation-only.

## Released behavior

- AI results are durable review-only observations. Confidence never authorizes purchase/shipment/document writes, and legacy AI without deterministic provenance is blocked.
- MailLens v2 prefers the current authored provider body over snippets, removes known hidden/quoted history, preserves useful URLs and retains raw provider evidence separately.
- PR #329 hardened the final AI evidence envelope: sanitized From metadata, received_at, subject, sender domains/role and the same current authored body consumed by validation are now supplied to the model.
- A production diagnostic mismatch was fixed: MailLens emits `bodyTextSource=snippet_fallback`, while the AI boundary had checked for `snippet`. Snippet-only input is now explicitly marked insufficient evidence and stays review-safe.
- Regression coverage proves that a short provider snippet cannot replace later order, tracking or payment evidence present in the full authored body, and quote-only mail cannot reintroduce archived snippet evidence.
- Extraction audit/prompt version is `email-extraction-v2.3-logistics-boundaries`. It adds explicit boundaries for packed-but-not-handed-over orders, courier pickup bookings, tracking-ID labels, physical carrier acceptance, conditional pre-notifications, subscription charge receipts and COD/locker receipts.
- PR #333 adds `luna-first-selective-sol-v1`: Luna always performs the first AI pass; Sol verifies only generic high-risk boundaries (evidence issues/low confidence, order_updated, missing shipment phase, merchant pre-handover shipment_created with order+tracking, and ambiguous order_created below 0.99). Successful Sol becomes the selected observation; verifier failures fall back to Luna. The Sol verifier can be disabled with `BUYFLOW_SOL_VERIFIER_ENABLED=false`.
- AI-run audit metadata records routing reasons, selected/primary/verifier models, core agreement, response IDs and combined token usage. The selected result is still persisted through `asAiObservation`, so neither Luna nor Sol gains commerce write authority.
- Deterministic automatic parsing still rejects empty/truncated authored bodies and inherited reply subjects.
- Source extraction remains fenced and atomic; expired workers cannot overwrite new claims. Client commerce writes remain denied and backend recovery checks passed.

## Invariants and limits

- Lifecycle-only mail cannot create a purchase. Ambiguous identities require REVIEW.
- AI remains observation-only; this release did not grant AI write authority, run historical rewrites, alter DDL, or automatically re-extract stored observations.
- A disjoint unseen-by-thread REAL30 human-gold holdout measured v2.3 Luna at 23/30 exact (76.7%) and full Sol at 28/30 (93.3%). The final selective workflow rerun used Sol on 5/30 messages (16.7%) and scored 27/30 exact (90%), 28/30 semantic exact (93.3%), 28/30 identity exact (93.3%); tracking/invoice/payment were 30/30. This is one mailbox holdout, not a universal accuracy guarantee.
- Historical REAL60/REAL100 MailLens v1.1 benchmark launchers contain an explicit `semanticText || snippet` fallback and must not be treated as evidence of the current production input path without rebuilding the benchmark through current MailLens.
- No claim of universal quote recognition, whole-app correctness or authenticated browser E2E coverage.

## Next action

Keep the selective verifier observation-only and monitor Sol routing/cost on new unseen mail. The next extraction gap is the remaining receipt/order-link recovery plus the rescheduled-delivery shipment-phase edge; validate any repair on a third unseen holdout before tuning the gate further. Then continue UI status/next-action alignment, purchase/inbox pagination, multi-account recovery and SES readiness.
