# BuyFlow V3 — current handoff

Updated: 2026-09-12. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; verify GitHub main and live state before acting. Older handoff experiments and protocol history remain in Git history.

## Verified runtime release

- Repository: kozmaasd0508/buyflow-v3.
- Previous baseline: `0ad651b06557d46c4f97d03b651149c551387479` (PR #318: reset, two-day initial scan, targeted lifecycle recovery).
- Released in PR #320, merge `464f00cd5d0c1a23de3169d1aecbcb2a3a04fdd5`. PR CI #34631655269 and main CI #34631830995 SUCCESS; exact Render Webhook Smoke #34631908053 SUCCESS (2026-09-11). Later documentation-only commits may have a different SHA; check current main before acting.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.

## Architecture and actual runtime

- TypeScript API: apps/api; mobile/web: apps/mobile; Supabase database; Nylas email ingestion.
- Durable webhook inbox and scan jobs, deterministic merchant/lifecycle parsers, evidence-based purchase/shipment/document resolution.
- Runtime model is pinned to gpt-5.6-luna. Shadow is enabled by default but requires OPENAI_API_KEY. BUYFLOW_AUTOMATION_MODE defaults to observe; deployed values must be verified independently.
- The runtime uses the V2 products/evidence extraction prompt and htmlToCompactText (20,000-character cap). It is not the MailLens local benchmark pipeline. Sol O2's 90% score is not app-wide accuracy.
- Production protocol registry remains empty; protocol research/test readiness does not authorize activation.

## Released behavior

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
- No protocol activation, model/prompt change or DDL in this release.

## Verification and limits

- Local and PR verification: 794/794 API tests, API typecheck, API/mobile build PASS.
- Regressions cover persisted/repeated AI observations, deterministic-only source linking, shared ingestion/AI-off policy and pagination beyond 200 rows.
- Tests use synthetic data and mocked providers/database boundaries. No real-mail E2E accuracy or live database integrity certification is claimed.
- Historical matching decisions and existing AI-derived purchases need a separate read-only audit before proposing data repair.
- Root handoff previously described an August release as current; main code and GitHub CI are stronger evidence.

## Audit repair in progress

- Branch `fix/audit-identity-document-security`: hard identity-conflict REVIEW, owner-scoped private attachment signing, and migration restricting client commerce writes.
- Local 801 API tests pass; migration includes effective-privilege assertions and a disposable PostgreSQL CI test. See newest worklog and GitHub checks for release status. Do not assume the migration is live from this file alone.
- No frontend, AI/model, SES activation or historical data changes in this batch.

## Next action

Finish the audit-repair PR/CI release and apply/verify the reviewed permission migration. Then address processing leases, SES schema/runtime readiness, UI status/pagination/multi-account recovery and MailLens integration. Validate the final email-to-UI flow on a frozen real-mail set; a standalone model benchmark is insufficient.
