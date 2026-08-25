# Unknown Webshop Semantic Composition Holdout v1 — freeze

Date: 2026-08-24

## Goal
Validate Semantic Composition Engine v1 on previously unread invoice/document candidates without merchant-specific patching.

## Frozen code snapshot
`3712d949d26110984a67cba2a5c7551ce0c23428`

No grammar, semantic or composition rule changes are allowed before the first holdout result is recorded.

## Candidate selection
Gmail ID-only query executed before reading content:

`after:2024/01/01 before:2025/01/01 -from:me -in:spam -in:trash {számla invoice Rechnung facture factura díjbekérő proforma}`

Selected: 9 incoming messages.

Only opaque SHA-256 prefixes are stored. Raw Gmail IDs, addresses, subjects, invoice numbers and message bodies are not committed.

## Frozen candidate hashes
- `3ae96be23f1f4ac3`
- `1da2c02644090ceb`
- `78be01f7ee7de5cd`
- `5f9d8ba24109c6e7`
- `fff2afc82429fd8f`
- `993ac7e762effe81`
- `e0f638aac25dc8b2`
- `ed2da6c425346651`
- `f03ef288e107f67b`

## Scoring rules
Classify ground truth only after freeze. Report separately:
1. final invoice/document events,
2. non-final proforma/payment-request/correction cases,
3. unrelated/noise cases,
4. composition decision (`actionable`, `review`, `blocked`),
5. wrong automatic lifecycle promotions.

Merchant-specific adapters do not count as universal success.

After first scoring, these messages become regression-only.
