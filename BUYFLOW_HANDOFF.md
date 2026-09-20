# BuyFlow V3 — current handoff

Updated: 2026-09-20. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; reconcile against GitHub main and exact deployment evidence before acting.

## Verified runtime

- Repository: kozmaasd0508/buyflow-v3. Latest verified runtime is PR #331, main `1c670dd34d40d61f249fc1224a9f8f7a8c5370cd`.
- PR #331 CI #35529312991, main CI #35529374707 and exact Render smoke #35529425612 SUCCESS; API/mobile typecheck, tests/builds and database/crash-recovery gates are green.
- The Render smoke verified the exact main commit through /health and the browser preview, plus auth, CORS and Nylas webhook guards.
- PR #331 Luna logistics-boundary prompt, PR #329 MailLens evidence envelope, PR #326 Luna evidence prompt and PR #324 MailLens v2 are incorporated.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.
- TypeScript API/mobile, Supabase, Nylas; runtime model pinned to gpt-5.6-luna. AI remains observation-only.

## Released behavior

- AI results are durable review-only observations. Confidence never authorizes purchase/shipment/document writes, and legacy AI without deterministic provenance is blocked.
- MailLens v2 prefers the current authored provider body over snippets, removes known hidden/quoted history, preserves useful URLs and retains raw provider evidence separately.
- PR #329 hardened the final AI evidence envelope: sanitized From metadata, received_at, subject, sender domains/role and the same current authored body consumed by validation are now supplied to the model.
- A production diagnostic mismatch was fixed: MailLens emits `bodyTextSource=snippet_fallback`, while the AI boundary had checked for `snippet`. Snippet-only input is now explicitly marked insufficient evidence and stays review-safe.
- Regression coverage proves that a short provider snippet cannot replace later order, tracking or payment evidence present in the full authored body, and quote-only mail cannot reintroduce archived snippet evidence.
- Extraction audit/prompt version is `email-extraction-v2.3-logistics-boundaries`. It adds explicit boundaries for packed-but-not-handed-over orders, courier pickup bookings, tracking-ID labels, physical carrier acceptance, conditional pre-notifications, subscription charge receipts and COD/locker receipts.
- Deterministic automatic parsing still rejects empty/truncated authored bodies and inherited reply subjects.
- Source extraction remains fenced and atomic; expired workers cannot overwrite new claims. Client commerce writes remain denied and backend recovery checks passed.

## Invariants and limits

- Lifecycle-only mail cannot create a purchase. Ambiguous identities require REVIEW.
- AI remains observation-only; this release did not grant AI write authority, run historical rewrites, alter DDL, or automatically re-extract stored observations.
- A fresh 30-message human-gold evaluation through current MailLens was completed. Before v2.3, Luna exact was 22/30 (73.3%) and Sol 27/30 (90%). On the same tuning set with v2.3, Luna reached 29/30 (96.7%) with identity 30/30 and shipment_phase 30/30; Sol reached 28/30 (93.3%). Treat these as tuning-set measurements, not a guarantee of unseen-mail accuracy.
- Historical REAL60/REAL100 MailLens v1.1 benchmark launchers contain an explicit `semanticText || snippet` fallback and must not be treated as evidence of the current production input path without rebuilding the benchmark through current MailLens.
- No claim of universal quote recognition, whole-app correctness or authenticated browser E2E coverage.

## Next action

Create an unseen holdout real-mail gold set before claiming generalized Luna accuracy; keep AI observation-only while evaluating. Then continue UI status/next-action alignment, purchase/inbox pagination, multi-account recovery and SES readiness.
