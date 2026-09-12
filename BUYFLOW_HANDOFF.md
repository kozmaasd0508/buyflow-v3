# BuyFlow V3 — current handoff

Updated: 2026-09-12. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; verify GitHub main and live state before acting. Older handoff experiments and protocol history remain in Git history.

## Verified runtime release

- Repository: kozmaasd0508/buyflow-v3.
- Latest runtime: PR #322, merge `253de7f93fa45c08f48911d75a0fc77c64e5e8bd` (2026-09-12). PR CI #34712428424, main CI #34712496392 and exact Render smoke #34712535387 SUCCESS. Later documentation-only commits may change SHA; always check current main.
- Production permission migration applied and verified: nine commerce/evidence tables reject client writes; backend access and RLS preserved.
- Previous runtime PR #320 introduced durable AI observation isolation, common ingestion and lifecycle pagination.
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
- No protocol activation or model/prompt change. Audit repair 1 adds the reviewed permission migration.

## Verification and limits

- Local and PR verification: 801/801 API tests, API typecheck, API/mobile build PASS.
- Regressions cover persisted/repeated AI observations, deterministic-only source linking, shared ingestion/AI-off policy and pagination beyond 200 rows.
- Tests use synthetic data and mocked providers/database boundaries. No real-mail E2E accuracy or live database integrity certification is claimed.
- Historical matching decisions and existing AI-derived purchases need a separate read-only audit before proposing data repair.
- Root handoff previously described an August release as current; main code and GitHub CI are stronger evidence.

## Released audit repair 1

- Conflicting exact order/tracking/thread identities now return REVIEW with no selected Purchase, even when merchant/amount/date scores favour one candidate.
- Private PDF signing requires the fixed bucket and authenticated owner's canonical attachment path; stored attachment URLs cannot bypass this gate.
- Client commerce writes revoked on nine tables. Effective grant assertions and disposable PostgreSQL CI regression protect this boundary; product edits continue through the authenticated API override route.
- 801 API tests, API/mobile build, PR/main CI, exact Render smoke and live DB grants verified. No historical data repair, frontend, AI/model or SES activation changes.

## Next action

Continue the authorized audit repair: recoverable source-processing leases and explicit external-call timeouts; SES schema/runtime readiness; unified UI status, pagination and multi-account recovery; MailLens normalization and runtime integration. Preserve existing AI observation-only authority. Validate email-to-UI behavior on a frozen real-mail set; standalone benchmarks are insufficient. Full authenticated browser E2E and real-mail accuracy remain unverified.
