# BuyFlow V3 — latest recovery worklog

## 2026-09-11 — Durable AI observation isolation and ingestion parity

- Based on main `0ad651b06557d46c4f97d03b651149c551387479` (PR #318).
- Review found that Luna observe mode was per invocation only: stored validated AI results could later enter a write reconciliation. New AI and audit-backfill results now persist review status, AI provenance, `shadow_only=true`, `would_write=false`, and preserve semantic validation separately.
- The common authority gate also excludes legacy AI V2 rows identified by `original_event_type` without parser/extraction provenance. Secondary recovery readers and the carrier bridge use the same policy. Existing purchases are not deleted or repaired by this change.
- Webhooks, initial scans and targeted scans share deterministic parser order, generic lifecycle fallback and Luna observation handling. AI-off fallback rows can be analyzed once when shadow is configured; repeat AI results are reused. The legacy AI-enabled flag cannot bypass the shared shadow kill switch.
- Deterministic lifecycle evidence is paginated in stable received_at/id order instead of stopping at the oldest 200 rows. Webhook/scan callers only run lifecycle writes in write mode.
- Validation: 794/794 offline API tests PASS; API typecheck and API/mobile build PASS. Added persisted/replayed AI authority, mixed deterministic evidence, ingestion route parity, AI-off and >200-row pagination regressions.
- No live customer mail read, database mutation, migration, protocol activation, or model/prompt change. Runtime accuracy on real mail remains unproven by these regression tests.
- Release pending: PR CI, merge, exact main CI and exact Render smoke. Do not claim deployed until those gates pass.
