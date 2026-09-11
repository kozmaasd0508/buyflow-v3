# BuyFlow V3 — current handoff

Updated: 2026-09-11. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; verify GitHub main and live state before acting. Older handoff experiments and protocol history remain in Git history.

## Current baseline and release candidate

- Repository: kozmaasd0508/buyflow-v3.
- Last verified main: `0ad651b06557d46c4f97d03b651149c551387479` (2026-09-09, PR #318: reset, two-day initial scan, targeted lifecycle recovery).
- Candidate: `fix/ingestion-shadow-parity-pagination` — durable AI isolation, shared ingestion and lifecycle pagination. Release status must be checked in GitHub; this document does not prove deployment.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.

## Architecture and actual runtime

- TypeScript API: apps/api; mobile/web: apps/mobile; Supabase database; Nylas email ingestion.
- Durable webhook inbox and scan jobs, deterministic merchant/lifecycle parsers, evidence-based purchase/shipment/document resolution.
- Runtime model is pinned to gpt-5.6-luna. Shadow is enabled by default but requires OPENAI_API_KEY. BUYFLOW_AUTOMATION_MODE defaults to observe; deployed values must be verified independently.
- The runtime uses the V2 products/evidence extraction prompt and htmlToCompactText (20,000-character cap). It is not the MailLens local benchmark pipeline. Sol O2's 90% score is not app-wide accuracy.
- Production protocol registry remains empty; protocol research/test readiness does not authorize activation.

## Candidate behavior

- Every newly persisted AI extraction and audit-backfill result is review-only with durable AI provenance and no-write flags. Semantic validation is preserved separately.
- Common write/recovery gates reject observations, generic shadow parsers and legacy AI V2 results lacking deterministic provenance. No historical Purchase is deleted or auto-repaired.
- Webhook, initial and targeted scanning use processCommerceMessage: deterministic lifecycle -> Limone -> commerce -> generic lifecycle -> optional Luna observation -> review fallback.
- When AI shadow is disabled, unmatched transactional mail stays in review. When configured, old AI-off fallback can receive one observation. Repeated observations reuse persisted extraction.
- Lifecycle evidence loads all pages ordered by received_at then id. Caller observe mode does not invoke the deterministic lifecycle write pass.

## Invariants

- Lifecycle-only mail never creates a Purchase in normal flow.
- Ambiguous identity matches stay REVIEW. No guessed order/tracking/merchant relationships.
- Generic parser families and AI observations cannot gain write authority from confidence or subsequent processing.
- Shipment label/pre-advice, ready-for-pickup and actual delivery remain distinct.
- No protocol activation, model/prompt change or DDL in this candidate.

## Verification and limits

- Candidate local verification: 794/794 API tests, API typecheck, API/mobile build PASS.
- Regressions cover persisted/repeated AI observations, deterministic-only source linking, shared ingestion/AI-off policy and pagination beyond 200 rows.
- Tests use synthetic data and mocked providers/database boundaries. No real-mail E2E accuracy or live database integrity certification is claimed.
- Historical matching decisions and existing AI-derived purchases need a separate read-only audit before proposing data repair.
- Root handoff previously described an August release as current; main code and GitHub CI are stronger evidence.

## Next action

Complete candidate PR CI -> exact-head merge -> main CI -> exact Render smoke. Record actual release proof in the worklog. After release, evaluate the actual runtime end-to-end on a frozen real-mail set, including duplicate/out-of-order deliveries and correct final UI state; do not substitute a standalone model benchmark.
