# Universal Order Identity v2 — blind measurement — 2026-08-24

## Frozen gate

- Implementation SHA before holdout content was opened: `997d1eb87fdd9aba90b349a5474137b3855da578`
- CI #983: GREEN
- API tests: 1160/1160 PASS
- Holdout candidate hashes were committed before opening content in `UNIVERSAL-ORDER-IDENTITY-V2-BLIND-FREEZE-2026-08-24.md`.
- No Identity v2 rule was changed between freeze and first score.

## Holdout ground truth

30 messages total:

- 20 incoming retail purchase-related messages/documents
- 10 service, personal, sent, quote, carrier-claim or other non-Purchase controls

Among the 20 incoming retail purchase-related messages:

- 16 contained an explicit hard order identifier in the visible message text
- 4 contained no explicit hard order identifier and therefore should remain without a hard order anchor

The identity-bearing group covered order confirmation, processing, shipment, delivery, invoice and warranty/document forms from multiple unrelated senders/templates.

## First blind score

### Hard order identity extraction

- Ground-truth incoming retail messages with explicit hard order identity: **16**
- Correctly recognized by Universal Order Identity v2: **15**
- Missed: **1**
- Blind hard-identity recall on this frozen subset: **93.75% (15/16)**

The single miss was a generic Hungarian abbreviated numbered-order form conceptually equivalent to:

`<id> sz. rendelés ...`

v2 already recognized the full `számú rendelés` form, but not the `sz.` abbreviation at freeze time.

### Correct fail-closed behavior when no hard order ID exists

- Incoming retail purchase-related messages with no explicit hard order identifier: **4**
- Correctly left without a hard order anchor: **4/4**

These included real retail invoice/delivery documents where guessing from invoice number, customer data or context would have been unsafe.

### Non-Purchase safety controls

- Non-Purchase/service/personal controls: **10**
- Unsafe automatic Purchase create/attach decisions attributable to Identity v2: **0/10**

Observed controls included service invoices/payment mail, personal/sent attachments, an offer document, a carrier claim thread and a sent reply containing quoted order language. The sent reply can contain an order-shaped identity, but public-mailbox/ownership safety keeps it non-authoritative.

### Important real-world identity shape

One retail order message contained both a prefixed display identity in the subject and a numeric `Rendelésszám` in the body. The values are related forms of the same merchant order. The universal matcher can observe both; downstream resolution must continue to prefer explicit labeled identity / merchant namespace and must never merge merely because two values look similar.

## Comparison with the previous seen regression set

This is not part of the blind score, but after CI #983 the previously inspected 8-invoice set was replayed conceptually as a regression check:

- before Identity v2: 0/8 had safe hard-order attach authority in the Universal ownership layer
- with Identity v2: 4/8 have a visible hard order anchor and become eligible for safe attach
- the remaining 4/8 truly have no explicit order number and correctly stay REVIEW

Do not present the 4/8 regression as a blind result.

## Interpretation

The first blind Identity v2 result supports the direction:

1. Most explicit real-world order identities are now recovered generically without merchant names.
2. Missing hard identifiers remain fail-closed instead of being guessed from invoice/customer/payment numbers.
3. The next generic gap is small and concrete: abbreviated numbered-order wording (`sz.`), plus full consolidation so EmailDocument, Extraction v2 and Ownership use the same identity source.

Do not describe 93.75% as global production accuracy. It applies only to the 16 identity-bearing incoming retail messages in this frozen 30-message holdout.