# Számlázz.hu invoicing protocol — 1.0.0-test.1

Status: **test / shadow only**

This profile family documents directly observed recipient-email behavior from Számlázz.hu and intentionally does not alter the production protocol registry.

## Identity / authentication

Observed direct Számlázz.hu invoice-related notifications use an account-specific sender address ending in `@szamlazz.hu`, for example `<merchant-local-part>@szamlazz.hu`.

Current official Számlázz.hu documentation confirms that invoice notifications are sent from an account-specific address ending in `@szamlazz.hu`; the local part can be customized before use. Therefore a single fixed sender address would be incorrect.

Representative raw recipient messages showed:

- `DKIM: pass` for `szamlazz.hu`
- `SPF: pass`
- `DMARC: pass`
- Return-Path below `ses.szamlazz.hu`
- Amazon SES transport

V1 therefore requires both:

1. a real sender address matching `*@szamlazz.hu`
2. exact `szamlazz.hu` DKIM evidence

Transport infrastructure is not treated as provider identity.

## Critical template finding

Számlázz.hu notification subjects and bodies are merchant-customizable.

A real observed notification used a shipping-oriented subject equivalent to “your order was handed to the courier” and contained merchant logistics wording, while the same authenticated message also explicitly stated that the invoice had been created and included the standard Számlázz.hu invoice download link.

Therefore:

- `@szamlazz.hu` does **not** make merchant logistics wording direct carrier authority.
- A shipping-looking Számlázz.hu notification must never become `SHIPPED`, `OUT_FOR_DELIVERY` or `DELIVERED` merely because the merchant wrote those words into the invoice notification template.
- The invoicing profile may recognize invoice evidence inside that email when the invoice-specific gates are satisfied.

## Normal invoice mapping

Profile: `invoicing.hu.szamlazz`

Safe mapping:

- authenticated `*@szamlazz.hu`
- exact `szamlazz.hu` DKIM
- direct `https://www.szamlazz.hu/szamla/fiok/...` access link
- explicit observed invoice-existence wording

→ `INVOICE`

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`

An invoice can belong to ecommerce, a service, subscription or B2B transaction. It cannot create or auto-link a BuyFlow purchase by itself.

### PDF attachment is not required

Observed legitimate messages exist in both forms:

- link-only invoice notification, no Gmail attachment
- invoice notification with a PDF attachment

V1 therefore does not require a PDF attachment.

### Conservative invoice ID extraction

When an attachment filename itself has a strong invoice-number shape such as:

`E-EX-2026-12345.pdf`

V1 may extract `E-EX-2026-12345` as `invoice_id`.

For link-only notifications, V1 may leave `invoice_id = null` rather than guess from merchant text.

## High-value raw header: X-Szamlazz-Invoice

Representative raw MIME contained a provider-specific header:

`X-Szamlazz-Invoice: <document-number>`

This was observed on:

- ordinary invoice notifications
- invoice notifications with PDF attachments
- merchant-customized notification text
- payment reminders
- storno notifications

This is stronger document identity evidence than a merchant-customizable subject/body.

However the current `ProtocolDetectionInput` does not expose arbitrary raw message headers. V1 therefore **does not pretend this header is available** and does not modify the protocol foundation merely to consume it.

Recommended future ingestion work:

- verify the live Nylas/raw-message header contract
- expose selected authenticated raw headers safely to shadow evaluation
- add a dedicated evidence field rather than concatenating arbitrary raw MIME into body text
- only then promote `X-Szamlazz-Invoice` to identifier evidence

## Storno / cancellation

Profile: `invoicing.hu.szamlazz.storno`

A direct authenticated recipient example explicitly said that an identified original invoice had been cancelled and that the storno invoice was attached.

Safe mapping in the current event vocabulary:

→ `OTHER`

Not:

- `INVOICE` as an ordinary valid invoice event
- `REFUNDED`

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

### Why no invoice ID is extracted from storno mail

The observed storno message contained two different document identities:

1. original invoice number in the email body
2. new storno-document number in the PDF filename and `X-Szamlazz-Invoice` header

A single `invoice_id` field cannot represent both without losing meaning. V1 therefore extracts neither.

A future document model should support something like:

- `document_type = cancellation_invoice`
- `document_id`
- `original_document_id`

## Payment reminder

Profile: `invoicing.hu.szamlazz.payment-reminder`

A direct authenticated example said that the invoice payment deadline was approaching and asked the customer to arrange settlement.

Safe mapping:

→ `OTHER`

Not:

- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `PAYMENT_SUCCESS`

A collection reminder can indicate that the invoicing system/issuer considered payment still due at send time. It does not prove a card/bank payment attempt failed, and it must not be treated as a permanent current payment state.

## Díjbekérő / proforma

Official Számlázz.hu documentation explicitly states that a díjbekérő is a payment request and **not an invoice**.

Targeted mailbox research did not find a direct authenticated recipient díjbekérő template in the researched mailbox, so V1 adds no positive proforma parser.

Invoice recognition contains díjbekérő hard-negative protection.

Do not map a proforma to `INVOICE` simply because it is delivered by Számlázz.hu.

## Módosító / helyesbítő

Official documentation confirms correction/modification workflows exist, but targeted mailbox searches did not provide a direct authenticated recipient template.

V1 therefore implements no positive módosító/helyesbítő parser.

## Payment-state safety

Invoice existence is not payment settlement evidence.

Do not infer `PAYMENT_SUCCESS` from:

- payment method text
- bank-card wording
- cash-on-delivery wording
- an invoice being generated
- a Számlázz.hu download link
- an invoice PDF existing

Payment-provider authority remains separate.

## Production boundary

These profiles exist only in `test-registry.ts`.

The production registry remains empty.

Promotion requires, at minimum:

- stable live ingestion of sender/DKIM evidence
- continued hard-negative coverage
- explicit review of raw-header support before relying on `X-Szamlazz-Invoice`
- no weakening of the direct-provider authority rules
