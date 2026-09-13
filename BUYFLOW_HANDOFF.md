# BuyFlow V3 — current handoff

Updated: 2026-09-13. Read AGENTS.md and BUYFLOW_WORKLOG_LATEST.md; reconcile against GitHub main and exact deployment evidence before acting.

## Verified runtime

- Repository: kozmaasd0508/buyflow-v3. Latest verified runtime is PR #326, main `edb1c1f42eb4dbfe9915da1aaad512e54882ad39`.
- PR #326 CI #34775854444, main CI #34775913614 and exact Render smoke #34775956674 SUCCESS; 838 offline tests and API/mobile build passed.
- PR #325 integrated CI #34760972022, main CI #34761064257 and exact Render smoke #34761105588 SUCCESS. 821 API tests and API/mobile build passed.
- PR #324 MailLens release `240cf36c8b058a49f165f119cc61bcaf1a4e0e68`: PR CI #34760802949, main CI #34760844420 and exact Render smoke #34760881629 SUCCESS.
- Preview: https://buyflow-v3-api-dev.onrender.com/app/ ; health: /health.
- TypeScript API/mobile, Supabase, Nylas; runtime model pinned to gpt-5.6-luna. Shadow requires OPENAI_API_KEY; automation defaults to observe. Actual deployed flags require independent verification.

## Released behavior

- AI results are durable review-only observations, including repeated processing and recovery. Confidence never authorizes purchase/shipment/document writes. Legacy AI without deterministic provenance is also blocked.
- Common ingestion runs deterministic lifecycle, Limone, commerce, generic lifecycle, optional Luna observation and review fallback. Generic parser families remain shadow-only.
- MailLens v2 tree parsing excludes known hidden subtrees and quoted history, preserves product URLs and emits normalization/truncation diagnostics. Automatic deterministic parsers and AI consume authored text; raw provider evidence is retained. Historical benchmark paths stay frozen.
- Deterministic automatic parsing rejects empty/truncated authored bodies and inherited reply subjects. Reproduced quoted-order eligibility and hidden cancellation regressions are covered.
- Source extraction uses fenced, five-minute claims and a 60-second external-call timeout. Audit/result writes are atomic; expired workers cannot overwrite new claims. Busy callers retry and stale sources are requeued durably.
- Production migration `20260912192905_recoverable_source_extraction.sql` applied. Four invoker RPCs: client execute denied, service execute allowed, no-op claims verified. PostgreSQL 17 CI passed. No historical customer data rewrite.
- PR #322 exact identity conflict review, owner-scoped PDF signing and client commerce-write revocation remain intact. Lifecycle evidence pagination is stable and exhaustive.

## Released Luna prompt repair

- PR #326 (`fix/luna-evidence-prompt`) addresses the user's explicit Luna prompt review request.
- Prompt v2.1 clarifies actual vs negated/future events, order creation, completed payment/refund, six logistics phases, conflicting/multiple-order evidence and untrusted email instructions.
- One strict Zod schema defines requested and accepted AI output. Required shipment_phase/evidence_issues fields; carrier purchase fields are null-only. Invalid and incomplete responses fail validation.
- Application-enforced incomplete-input issues and inherited subject suppression accompany the prompt. Evidence issues force semantic review and prevent purchase eligibility; pickup-ready/delivery conflicts also require review.
- Local: 838 API tests, typecheck and API/mobile build PASS. PR/main CI and exact Render smoke passed. Model unchanged; no paid model evaluation. Existing observations are not automatically reprocessed.

## Invariants and limits

- Lifecycle-only mail cannot create a purchase. Ambiguous identities require REVIEW. No protocol or SES activation; production protocol registry remains empty.
- No claim of whole-app correctness, full CSS visibility, universal quote recognition, real-mail Luna accuracy or authenticated browser E2E coverage. Offline fixtures/mock Responses cannot prove model semantics.
- Existing security advisor findings remain: leaked-password protection warning and backend RLS/no-policy infos. Existing performance findings include missing FK indexes/initplan; the new lease index initially reports unused.
- Historical matching and AI-derived purchases require read-only audit before proposed data repair.

## Next action

Address UI status/next-action mismatches, purchase/inbox pagination, multi-account recovery and SES schema/runtime readiness. Preserve AI observation-only authority and evaluate the email-to-UI flow on a frozen real-mail set before claiming real accuracy. Browser-first for frontend changes; APK only on explicit request.
