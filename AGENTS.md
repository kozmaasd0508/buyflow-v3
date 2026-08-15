# BuyFlow agent instructions

This repository uses a persistent handoff so a new AI/chat can continue the project without asking the user to retell prior work.

## Mandatory startup sequence

Before proposing or changing anything in BuyFlow:

1. Read `BUYFLOW_HANDOFF.md` completely.
2. Read the newest entries in `BUYFLOW_WORKLOG.md`.
3. Check the current `main` HEAD and recent merged PRs. If the handoff is older than `main`, reconcile it against Git history before acting.
4. Treat code, live Supabase state, CI and deployed behavior as stronger evidence than the handoff if they conflict.
5. Do not ask the user to repeat project history that can be recovered from the repository, GitHub, Supabase or the handoff.

If the user says only **"Folytasd a BuyFlowot a GitHubból"**, perform the startup sequence above and continue from `NEXT ACTION` in `BUYFLOW_HANDOFF.md`.

## Mandatory shutdown/update sequence

After any meaningful BuyFlow change, especially after a merged PR or live verification:

1. Update `BUYFLOW_HANDOFF.md` so it describes the current state only.
2. Add a short newest-first entry to `BUYFLOW_WORKLOG.md` with date, PR/commit, what changed, verification and remaining issue.
3. Keep `BUYFLOW_HANDOFF.md` concise. Move history to the worklog instead of letting the handoff grow indefinitely.
4. Never place secrets, tokens, passwords, raw customer email bodies or private personal data in these files.

## Project safety rules

- Browser-first frontend workflow: modify -> browser test -> refine -> APK only after explicit user approval/request.
- Purchase creation and lifecycle events are separate. A lifecycle-only email must not create a Purchase in normal flow.
- Multiple possible purchase matches => REVIEW, never unsafe auto-link.
- Prefer deterministic parsers and durable evidence when confidence is high; do not loosen global rules to fix one merchant.
- AI-disabled flows must remain safe and auditable.
- Supabase DDL must go through migrations. Re-check advisors after DDL.
- Use branch -> PR -> CI -> merge -> main CI -> exact Render smoke for production changes.
- Do not claim a deploy is live until exact commit deployment/smoke verification passes.

## Source of truth priority

1. Live DB / live API / deployed app behavior
2. `main` code and merged Git history
3. `BUYFLOW_HANDOFF.md`
4. `BUYFLOW_WORKLOG.md`
5. Old chat history
