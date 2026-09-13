# BuyFlow — latest worklog entry

## 2026-09-13 — Luna prompt and response validation

- Branch `fix/luna-evidence-prompt` from verified main `21236b06f57002606d0fabbba24a7c0cc2bb5484`; user explicitly requested Luna prompt review.
- Prompt now separates current affirmative facts from negation, inherited/quoted history, future promises and multi-record ambiguity. Adds explicit logistics phase and evidence issue fields.
- Shared strict Zod response/request contract rejects malformed fields, carrier purchase inventions and incomplete Responses. Application-known incomplete input forces evidence issues even if the model omits them. AI and validation share suppressed inherited subjects/current body.
- Semantic issues block purchase eligibility; pickup-ready/delivery conflicts require review. Existing durable AI shadow authority unchanged; no automatic re-extraction of old observations.
- 838 offline tests, typecheck and API/mobile build PASS. No paid AI calls or real-mail accuracy claim. PR/CI/release pending.
- Reconciled prior release: PR #325 integrated CI #34760972022, main CI #34761064257 and exact Render smoke #34761105588 SUCCESS. Production extraction lease migration applied; client-denied/service-allowed RPC grants and safe no-op calls verified. Existing advisors only; no historical data rewrite.

