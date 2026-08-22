# BuyFlow worklog latest

Current shadow branch: `codex/mailgun-inbound-shadow-v3`

Current shadow head: `d9c6a05c217836e1759dd43002d2114ce9b78c1b`

CI for this exact head is green (`CI` run #799, conclusion: success).

## Blind audit progression

- v5 first blind run: TP 40 / FN 10 / FP 3 / TN 47; precision 93%, recall 80%.
- PR #188 added narrowly scoped provider fixes only; broad generic matching stayed unchanged.
- v5 live regression reached 100/100 and was documented by PR #189.
- v6 first blind run: TP 42 / FN 8 / FP 0 / TN 50; precision 100%, recall 84%.
- PR #191 added narrowly scoped provider fixes only.
- v6 live regression reached 100/100 and was documented by PR #192.
- v7 fresh blind audit was added by PR #193 using separate Gmail Commerce/Noise labels and a metadata-free repository fixture design.
- v7 first blind run: TP 45 / FN 5 / FP 0 / TN 50; precision 100%, recall 90%.
- PR #194 added scoped fixes for exactly those five false negatives: Prime Video subscription reactivation, Gate loyalty credit, Allegro shipped notice, MPL/Posta formal Csomagküldemény, and Epic Games receipt.
- PR #194 is merged into the shadow branch.

## Safety status

- provider fixes remain `provider-lifecycle-v6-shadow`.
- broad generic detector is not loosened for blind-audit fixes.
- frozen v5/v6/v7 ground truth is not edited after the first blind run.
- audit paths perform 0 production writes and 0 AI calls.
- automatic production promotion remains blocked.

## Next gate

Run `/audit-v7` on the live dev deployment after `d9c6a05c217836e1759dd43002d2114ce9b78c1b` is deployed.

Expected regression gate before moving on:
- 100/100 matched
- precision 100%
- recall 100%
- FP 0
- FN 0
- 0 semantic-critical classification errors
- 0 production writes
- 0 AI calls

Do not create new detector rules from v7 unless the regression still exposes a real error. If v7 is 100/100, document the live regression and then freeze a completely fresh v8 blind holdout before any further parser changes.
