# Phase E — 100 real lifecycle selection — immutable attempt 2

Date: 2026-08-26
CI: #1053
Mode: private Gmail/Nylas read-only · 0 production writes · 0 AI

Selection v2 scanned all **1065** messages returned by the frozen Gmail Purchases source window and found **63** unique qualifying chain anchors.

CI stopped before graph replay with:
`root_selection_count_mismatch:63`

Therefore this is still a selection-preflight result, not a 100-chain Purchase Identity score.

Compared with Attempt 1, relaxing only literal order-confirmation wording increased qualifying exact-order chains from 31 to 63. The remaining bottleneck is the requirement that the anchor message itself contain explicit physical shipping/delivery structure.

That requirement is unnecessarily narrow for chain discovery: a merchant payment/status/packing/invoice-facing message can carry the exact order identity even when that single message does not repeat delivery method/address. Exact-ID lifecycle expansion can recover the physical fulfillment evidence later.

No production safety gate was changed. API tests were 1242/1242 PASS before the private selection step.