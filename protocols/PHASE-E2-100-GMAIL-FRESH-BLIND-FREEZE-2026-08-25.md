# Phase E2 — 100-message fresh blind Gmail freeze

Frozen before reading message bodies.

Selection protocol:
- Window: 2026-06-01 through 2026-06-30.
- 70 messages: Gmail `category:purchases`, excluding spam/trash, first 70 message IDs returned by search.
- 30 messages: not `category:purchases`, excluding spam/trash, first 30 message IDs returned by search.
- No message body was read before this freeze.
- Raw Gmail message IDs are never stored in GitHub.
- The exact ordered 100-message selection is committed by one salted SHA-256 set digest.
- Set digest: `49a9e6ab3f9e1fcd13f773feba80f569555b24a0331363e63f666da693cad885`
- Precision-first scoring: any unsafe automatic CREATE/LINK is a hard failure; REVIEW/unrecognized may count as safe misses.
- 0 production writes; 0 AI.
