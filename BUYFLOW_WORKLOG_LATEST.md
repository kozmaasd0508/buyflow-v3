# BuyFlow — latest worklog entry

## 2026-09-13 — MailLens semantic evidence repair (in progress)

- Independent branch `fix/maillens-semantic-evidence`, based on main `c39a36e43fc00bcc14471098e3d05c726ef55e7b`; recovery/migration repair remains on its separate branch.
- Reproduced five failures against frozen historical MailLens `f691954`: visible not-hidden classes removed, nested hidden delivery leaked, short replies retain history, placeholder plain text masks HTML, quote-only mail retains old delivery.
- Added MailLens text v2 with HTML tree parsing, subtree visibility/quote filtering, exact placeholder fallback and explicit truncation/provenance. Current authored text is distinct from full visible body; an empty semantic result never falls back to quoted text or snippet.
- Automatic Nylas AI extraction now uses this semantic text and passes identical evidence to validation. AI-run/validated-result metadata records normalization version and diagnostics; original provider email is unchanged. Existing AI observation-only authority remains intact.
- Local API typecheck, clean-lockfile install, API/mobile build and 813 tests PASS, including actual mocked Responses request inspection. No paid AI call or customer data mutation.
- Limits: no full CSS rendering, no claim of universal quote detection or real-mail accuracy. Deterministic parsers and historical benchmark launchers are not switched by this change; their remaining input paths need separate audit. Stored observations are not automatically reprocessed. Production release requires PR CI, main CI and exact Render smoke.

