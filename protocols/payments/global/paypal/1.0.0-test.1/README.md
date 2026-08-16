# PayPal payment research profile — 1.0.0-test.1

Status: **shadow/test only**

Protocol: `payment.paypal`

## Why this V1 is intentionally hard-negative only

The mailbox research pass did not find a direct authenticated PayPal buyer transaction email for:

- successful purchase payment
- failed/declined payment
- payer action / 3DS action required
- completed refund
- dispute / claim lifecycle
- subscription charge

PayPal's official APIs document these concepts, but an API status name is not proof of an email template. BuyFlow therefore does not invent positive email rules from API documentation.

V1 records only two authenticated PayPal recipient-email families that were directly observed and are known **not** to be purchase lifecycle evidence.

## Observed authenticated family 1: monthly PayPal account statement

Observed sender:

`paypal@mail.paypal.com`

Observed authentication:

- DKIM: `mail.paypal.com` PASS
- SPF: `bounce@mail.paypal.com` PASS
- DMARC: `paypal.com` PASS

Observed Hungarian subjects include:

- `Tekintse át, milyen pénzmozgások történtek számláján az utóbbi időben.`
- `Elkészült az első PayPal-számlakivonata`

Safe mapping:

`OTHER`

Why this matters: the statement/marketing body can contain words about transactions, returns, refundable returns and reimbursement. Those words are not evidence that a particular BuyFlow purchase was refunded or returned.

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

## Observed authenticated family 2: PayPal legal/account communications

Observed sender:

`no_reply@communications.paypal.com`

Observed authentication:

- DKIM: `communications.paypal.com` PASS
- SPF: PASS
- DMARC: `communications.paypal.com` PASS

Observed subjects include:

- `We're making some changes to our PayPal legal agreements`
- Hungarian equivalent about modifying PayPal legal agreements

Safe mapping:

`OTHER`

This is account/legal communication, not purchase or payment lifecycle evidence.

## Positive payment events intentionally unsupported

V1 does **not** implement:

- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `REFUNDED`
- dispute/claim lifecycle

Reason: no direct authenticated buyer-recipient template for these events was verified in the researched mailbox.

## Official PayPal status semantics are context, not email templates

PayPal Orders/Payments APIs distinguish capture states including:

- `COMPLETED`
- `DECLINED`
- `PENDING`
- `FAILED`
- `PARTIALLY_REFUNDED`
- `REFUNDED`

PayPal also documents `PAYER_ACTION_REQUIRED` for order flows such as 3DS authentication.

These states are useful for future API integrations, but they must not be converted into guessed email regexes.

PayPal's refund documentation also distinguishes multiple stages, including initiated, processing/sent, pending and completed. Therefore generic `refund`, `visszatérítés` or similar wording must not automatically become BuyFlow `REFUNDED`.

## Security boundary

PayPal explicitly warns about phishing, fake payment confirmations, invoice scams and money requests. A display name that says PayPal, a PayPal-looking subject or even payment terminology is insufficient authority.

The current profile requires the exact observed sender family and the corresponding authenticated DKIM domain for the two supported hard-negative email families.

Unverified PayPal-looking transaction senders, merchant-origin emails mentioning PayPal, lookalike DKIM domains and subject-only transaction claims are rejected.

## Promotion gate

Before any positive PayPal payment event is added, collect multiple sanitized direct recipient examples and verify raw MIME for each relevant sender generation:

1. exact From address
2. DKIM domain and result
3. SPF / Return-Path
4. DMARC
5. stable body structure
6. stable transaction identity format
7. amount/currency semantics
8. merchant/reference semantics
9. hard-negative lookalikes
10. cross-language variants where relevant

Only then should `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_ACTION_REQUIRED` or `REFUNDED` be considered.

## Production impact

None.

This profile is registered only in `test-registry.ts`. The production registry remains empty, so no live BuyFlow recognition or writes are changed.
