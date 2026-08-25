# TechnicalEvidence Retro Holdout v1 — status correction

**Date:** 2026-08-24 Europe/Budapest

The 200-message candidate set in `TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-2026-08-24.md` was genuinely selected and Gmail-labelled using IDs only before message content was opened.

During annotation, before a first executable TechnicalEvidence result existed, we discovered that the previously reported v1.4/v1.5 figures were a **development projection across separate modules**, not output from one composite collector. The historical message content had already been inspected when this integration gap was discovered.

Therefore:

- candidate selection remains uncontaminated and useful;
- the 200-message set is retained as a strong **retro-generalization / characterization / regression** dataset;
- it MUST NOT be described as a pristine blind result for the new executable v1.5 collector;
- no previously viewed message from this set may be reused as future-blind evidence;
- the new executable collector starts at `technical-evidence-v1-5.ts` and requires a fresh future freeze after exact-code CI validation;
- the future post-freeze holdout remains the authoritative blind generalization gate.

The correction is intentional: preserving audit honesty is more important than preserving the word “blind”.

Safety invariants remain 0 production writes, 0 AI calls, no DB mutation and no Purchase/Identity Graph authority.
