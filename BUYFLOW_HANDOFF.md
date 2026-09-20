# BuyFlow V3 — current handoff

Updated: 2026-09-20. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; reconcile against GitHub main and exact deployment evidence before acting.

## Verified runtime

- Repository: kozmaasd0508/buyflow-v3. Latest verified runtime is PR #329, main `d651b41f6f1d2aa9167f0e7d0689c20a8542e0f7`.
- PR #329 CI #35526559348, main CI #35526625907 and exact Render smoke #35526656180 SUCCESS; 842/842 API tests passed, with API/mobile typecheck and builds green.
- The Render smoke verified the exact main commit through /health and the browser preview, plus auth, CORS and Nylas webhook guards.
- PR #326 Luna prompt repair and PR #324 MailLens v2 remain incorporated.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.
- TypeScript API/mobile, Supabase, Nylas; runtime model pinned to gpt-5.6-luna. AI remains observation-only.

## Released behavior

- AI results are durable review-only observations. Confidence never authorizes purchase/shipment/document writes, and legacy AI without deterministic provenance is blocked.
- MailLens v2 prefers the current authored provider body over snippets, removes known hidden/quoted history, preserves useful URLs and retains raw provider evidence separately.
- PR #329 hardened the final AI evidence envelope: sanitized From metadata, received_at, subject, sender domains/role and the same current authored body consumed by validation are now supplied to the model.
- A production diagnostic mismatch was fixed: MailLens emits `bodyTextSource=snippet_fallback`, while the AI boundary had checked for `snippet`. Snippet-only input is now explicitly marked insufficient evidence and stays review-safe.
- Regression coverage proves that a short provider snippet cannot replace later order, tracking or payment evidence present in the full authored body, and quote-only mail cannot reintroduce archived snippet evidence.
- Extraction audit/prompt version is `email-extraction-v2.2-evidence-envelope`; the event-evidence semantics and strict response schema from v2.1 remain intact.
- Deterministic automatic parsing still rejects empty/truncated authored bodies and inherited reply subjects.
- Source extraction remains fenced and atomic; expired workers cannot overwrite new claims. Client commerce writes remain denied and backend recovery checks passed.

## Invariants and limits

- Lifecycle-only mail cannot create a purchase. Ambiguous identities require REVIEW.
- AI remains observation-only; this release did not grant AI write authority, run historical rewrites, alter DDL, or automatically re-extract stored observations.
- No new paid Luna/Sol real-mail evaluation was performed in PR #329. Offline/mock tests verify application behavior, not model semantic accuracy.
- Historical REAL60/REAL100 MailLens v1.1 benchmark launchers contain an explicit `semanticText || snippet` fallback and must not be treated as evidence of the current production input path without rebuilding the benchmark through current MailLens.
- No claim of universal quote recognition, whole-app correctness or authenticated browser E2E coverage.

## Next action

Build a fresh/current frozen real-mail evaluation through the production MailLens evidence path and rerun Luna versus Sol before making a new real-mail accuracy claim. Keep AI observation-only while evaluating. After that, continue UI status/next-action alignment, purchase/inbox pagination, multi-account recovery and SES readiness.
