# Unknown Webshop Semantic Composition Positive Holdout v1 — freeze

Date: 2026-08-24

## Goal
Measure Semantic Composition Engine v1 on an unseen, attachment-enriched invoice/document candidate set without merchant-specific patching.

## Frozen code snapshot
`3712d949d26110984a67cba2a5c7551ce0c23428`

No grammar, semantic or composition rule changes are allowed before the first score is recorded.

## Candidate selection
Gmail ID-only query executed before reading any selected message content:

`after:2025/01/01 before:2026/01/01 -from:me -in:spam -in:trash has:attachment {számla invoice Rechnung facture factura nyugta receipt}`

Selected: first 30 incoming messages.

No merchant names were used in selection. Only opaque SHA-256 prefixes are committed. Raw Gmail IDs, addresses, subjects, invoice/order numbers and message bodies are not committed.

## Frozen candidate hashes
- `d217de07922daad0`
- `853da4cfd333ac59`
- `9a365bdae96ce899`
- `5fe9001b3a3f86d0`
- `710989954755966b`
- `aedd902766a577df`
- `c7fafb60014e537a`
- `b59e268142860420`
- `0ede7260cb7de2bb`
- `1251e35d551f47e5`
- `4c8c467a6e050bef`
- `b0e80af9a630d446`
- `9d885162f2acf33d`
- `abe0b4a589391980`
- `75d8aaaa8d58005a`
- `66ac544436c374e2`
- `44d2c12bf65883d9`
- `14421fc4b08aff4a`
- `5c9dc73321426e58`
- `35863d7e24bd8aef`
- `0890ea6e1cb317e3`
- `1e51c79350ba78ba`
- `9ff46ffd1c16f52a`
- `5e04babd31338597`
- `cfbf449a384998bc`
- `199020931250a4bf`
- `79eba9299ccbae2b`
- `dfce386b2c6a26d1`
- `15dce25de008f8ce`
- `e8412a5c15a58cf1`

## Scoring rules
Ground truth is assigned only after this freeze.

Report:
1. real final invoice/document deliveries,
2. non-final proforma/payment-request/correction documents,
3. unrelated/noise,
4. automatic invoice recognitions,
5. misses / REVIEW,
6. wrong automatic lifecycle promotions,
7. merchant-specific dependency.

A merchant-specific adapter does not count as universal success. The composition snapshot is scored from semantic evidence + attachment structure only.

After first scoring, these cases become regression-only.
