# V7 blind audit checkpoint

Shadow head before this documentation-only checkpoint: `d9c6a05c217836e1759dd43002d2114ce9b78c1b`.

CI for that exact head: green.

V7 first blind run: TP 45 / FN 5 / FP 0 / TN 50, precision 100%, recall 90%.

PR #194 merged scoped fixes for the five false negatives: Prime Video subscription reactivation, Gate loyalty credit, Allegro shipped notice, MPL/Posta formal Csomagküldemény, and Epic Games receipt.

Next live gate: rerun `/audit-v7` after the merged shadow head is deployed. Required: 100/100, precision 100%, recall 100%, FP 0, FN 0, 0 production writes, 0 AI calls.

No runtime behavior is changed by this checkpoint.
