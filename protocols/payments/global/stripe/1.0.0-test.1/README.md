# Stripe payment authority — `1.0.0-test.1`

Status: **test / shadow only**

Protocol ID: `payment.stripe`

This profile recognizes a deliberately narrow subset of Stripe-generated customer receipts. It is not a general Stripe parser and it does not modify BuyFlow production recognition.

## Research basis

The profile combines:

- repeated real customer receipt emails from different merchants and dates;
- English and Hungarian localized receipt structures;
- raw MIME authentication evidence;
- current Stripe documentation for successful-payment receipts, refund receipts, customer billing emails and custom email domains.

No private recipient, card, merchant transaction or payment identifier from the mailbox is committed. Test fixtures are synthetic.

## Observed direct sender model

Stripe does not use one fixed sender address for these customer receipts. Observed direct sender forms were:

- `receipts+acct_<stripe-account>@stripe.com`
- `invoice+statements+acct_<stripe-account>@stripe.com`

Representative raw MIME showed:

- DKIM: pass for `stripe.com`
- SPF: pass
- DMARC: pass for `stripe.com`
- Return-Path: `...@bounce.stripe.com`
- Amazon SES outbound transport

The SES host is transport evidence, not the provider identity boundary.

V1 requires:

1. sender domain `stripe.com`;
2. one of the observed Stripe-generated sender-address shapes;
3. DKIM domain exactly `stripe.com`;
4. an explicit receipt number;
5. an explicit paid amount;
6. an explicit paid date;
7. a Stripe-hosted receipt URL.

## Supported event

### `PAYMENT_SUCCESS`

Observed successful payment receipt examples included the following structural fields.

English direct payment receipt:

- `Receipt #1166-4449`
- `Amount paid`
- `Date paid`
- payment method suffix
- Stripe-hosted `dashboard.stripe.com/receipts/payment/...` link

English paid-invoice receipt:

- `Receipt number`
- `Invoice number`
- `Paid <date>`
- `Amount paid`
- Stripe-hosted invoice and receipt links
- PDF invoice and receipt attachments may be present

Hungarian localized receipt:

- `Elismervény száma`
- `Kifizetett összeg`
- `A fizetés dátuma`
- payment method suffix
- Stripe-hosted receipt link

Stripe's documentation states that automated email receipts for payments are sent only for successful payments and not for failed or declined payments. This supports treating the authenticated paid-receipt structure as payment-success evidence.

## Identifier handling

Stripe documents the receipt number as a unique identifier useful for looking up payment information. V1 therefore extracts the receipt number as `payment_reference`.

V1 deliberately does **not** promote:

- merchant order-like text to `order_id`;
- a Stripe invoice number to `invoice_id`;
- card suffixes to payment references;
- identifiers hidden in hosted URLs to BuyFlow purchase identifiers.

Invoice interpretation belongs to the invoicing phase rather than this payment-authority profile.

## Safety prohibitions

Every `PAYMENT_SUCCESS` candidate carries:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

A Stripe receipt can represent SaaS, a subscription, an invoice payment, a conventional webshop purchase or another service payment. Payment evidence alone therefore cannot establish a BuyFlow purchase identity.

## Refund boundary

Stripe documents refund receipts as a separate customer-email capability. A hosted receipt can also later reflect the current refunded status of the charge.

No direct authenticated refund recipient email was found in the researched mailbox. Therefore V1 does **not** implement `REFUNDED`.

Refund-like subject/body wording is negative evidence for the success rule. If success structure and refund wording ever coexist, the candidate is blocked from automatic decision rather than silently promoted.

## Failed payment and action-required boundary

Stripe documentation confirms separate customer emails for:

- failed payment attempts;
- payments requiring 3D Secure authentication;
- issued refunds;
- paid-invoice receipts;
- other billing lifecycle events.

Targeted Gmail searches found no direct authenticated recipient templates for failed-payment, action-required/3DS or refund emails in this mailbox.

Therefore V1 intentionally implements none of:

- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `REFUNDED`

Documentation proves that these classes exist; it does not justify inventing an exact email parser without a verified recipient template.

## Custom email domains

Stripe allows merchants to configure a custom sending domain instead of the default `stripe.com` domain.

V1 intentionally does **not** recognize those custom-domain emails. Accepting arbitrary merchant domains as Stripe payment authority would weaken the provider boundary and could make ordinary merchant mail look like direct Stripe evidence.

A future custom-domain design needs a separate trustworthy attribution mechanism.

## Hard negatives

Regression coverage includes:

- receipt subject alone;
- lookalike DKIM such as `stripe.com.attacker.example`;
- merchant-origin email that merely mentions Stripe;
- `support@stripe.com`, `notifications@stripe.com` and plain `receipts@stripe.com` inheriting payment authority;
- custom merchant sending domain;
- finalized/unpaid invoice-like message;
- refund-like authenticated content;
- unsupported failed/action-required/refund phrases.

## Production boundary

This profile is registered only in `test-registry.ts`.

`apps/api/src/protocols/registry.ts` remains empty. No production behavior, write path, database schema, mobile UI or runtime AI is changed by this profile.

Promotion should not be considered until live ingestion can supply authenticated DKIM-domain evidence and broader false-positive/false-negative evaluation is complete.

## Sources

Official Stripe documentation:

- https://docs.stripe.com/receipts
- https://docs.stripe.com/payments/advanced/receipts
- https://docs.stripe.com/invoicing/send-email
- https://docs.stripe.com/get-started/account/email-domain
