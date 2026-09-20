# BuyFlow — latest worklog entry

## 2026-09-20 — MailLens evidence envelope hardened (PR #329)

- Merge `d651b41f6f1d2aa9167f0e7d0689c20a8542e0f7`; PR CI #35526559348, main CI #35526625907 and exact Render smoke #35526656180 SUCCESS. 842/842 API tests passed; API/mobile typecheck and builds passed.
- Fixed the `snippet_fallback` diagnostic mismatch, so snippet-only evidence now forces `insufficient_evidence`. The AI request now receives sanitized From metadata, received_at, subject, sender domains/role and the same current authored body validation consumes.
- Full provider body remains authoritative over snippets; regressions cover late order/tracking/payment evidence and quote-only snippet suppression. AI remains observation-only; no DDL, customer-data rewrite, historical re-extraction or paid model evaluation.
- Next: rebuild a fresh/current frozen real-mail evaluation through the production MailLens path and compare Luna versus Sol; do not use historical v1.1 launchers as current-runtime accuracy evidence.
