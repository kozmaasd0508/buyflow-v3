# Phase E — 100 real lifecycle selection — immutable attempt 1

Date: 2026-08-26
CI: #1050
Mode: private Gmail/Nylas read-only · 0 production writes · 0 AI

## Frozen attempt

Source query:
`after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`

Candidate cap: 1200
Requested physical-order roots: 100

The first selection implementation required all of:
- explicit stable order identity;
- explicit fresh order-received/confirmed semantics;
- physical shipping/delivery structure;
- no reply/forward root;
- no obvious digital/subscription-only root;
- exact sender-domain + normalized order id uniqueness.

## Result

The selection preflight found only **31 qualifying roots**.

The CI stopped with:
`root_selection_count_mismatch:31`

Therefore:
- no 100-chain lifecycle replay was performed;
- no correlation score was produced;
- no unsafe cross-chain result was observed because the graph replay did not start;
- this is a dataset-selection miss, not a Purchase Identity v2 safety failure;
- API regression suite before the private step remained 1242/1242 PASS.

This attempt is immutable and must not be overwritten or presented as a 100-order score.

## Generic diagnosis

The selection rule was too narrow because a real physical purchase can enter the Gmail Purchases category through a later order-status, packing, payment, invoice, or shipment-facing merchant message even when the particular candidate message does not contain a literal order-received/confirmed phrase.

Requiring confirmation wording at root-selection time unnecessarily discards valid exact-order chains. That requirement belongs to Purchase creation authority, not to selecting an audit chain anchor.

## Next selection protocol

A revised selection protocol will remain independent of Purchase Identity v2 outcomes but will select chain anchors from exact transaction structure:
- explicit stable order identity;
- physical-commerce structure;
- non-digital context;
- exact sender-domain + order-id grouping;
- the candidate message is only an anchor used to discover the exact-ID lifecycle, not proof that a Purchase should be auto-created.

Production logic and promotion-readiness rules remain unchanged.