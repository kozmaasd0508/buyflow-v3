# SimplePay Hungary — `payment.hu.simplepay@1.0.0-test.1`

Status: **test / shadow only**

This profile is intentionally absent from the production registry.

## Research scope

Research date: 2026-08-16.

Evidence sources:

- repeated authenticated recipient emails from `noreply@simplepay.hu` across multiple payment contexts;
- raw MIME verification of direct online, stored-card and Telefonos POS success emails;
- current SimplePay Online payment documentation: https://simplepay.hu/online-fizetes/;
- current SimplePay FAQ, including separate unsuccessful Sandbox outcomes: https://simplepay.hu/gyik/.

No private customer names, addresses, card digits or real transaction IDs are committed to the repository. Tests use sanitized synthetic fixtures only.

## Authenticated identity

Observed direct payment receipt channel:

- sender: `noreply@simplepay.hu`;
- sender domain: `simplepay.hu`;
- DKIM: `simplepay.hu`, pass;
- SPF: pass;
- DMARC: pass;
- Return-Path: `noreply@simplepay.hu`;
- observed transport: `mail.otpmobil.com`.

Transport host is documented but deliberately not required as the identity gate. V1 requires the exact sender plus authenticated `simplepay.hu` DKIM evidence.

Marketing mail from `simple@simpleapp.hu` / `SimplePay Partner` is a different channel and must not match this payment profile.

## PAYMENT_SUCCESS

Observed subject family:

- `SimplePay - Sikeres fizetés`
- `SimplePay - Sikeres fizetés - <merchant URL>`

The subject alone is insufficient.

V1 also requires all of the following direct-provider body evidence:

- `SimplePay tranzakció azonosító: ...`;
- `Fizetett összeg: ... HUF/Ft`;
- explicit successful-payment evidence, such as the SimplePay generated-message statement that it confirms successful payment, or a POS `Tranzakció státusza: Sikeres` field.

Safe mapping:

`PAYMENT_SUCCESS`

### Supported observed success families

1. conventional online merchant payment;
2. previously stored card / recurring-style successful charge;
3. SimplePay Telefonos POS success.

The SimplePay transaction ID is extracted as `payment_reference`.

## Why PAYMENT_SUCCESS must not create a purchase

The researched mailbox contained the same authenticated SimplePay success family in materially different contexts, including:

- conventional webshop payment;
- carrier/POS payment;
- subscription/SaaS payment;
- telecom/service payment;
- debt/payment-service context;
- public-administration payment.

Therefore `PAYMENT_SUCCESS` carries:

- `DO_NOT_CREATE_PURCHASE`;
- `DO_NOT_AUTO_LINK`;
- `DO_NOT_MARK_REFUNDED`.

A later merchant-specific resolver may establish a safe link when an exact purchase-side reference relationship is independently verified. V1 does not guess that relationship.

## External reference is not a global order ID

Observed online SimplePay receipts include a `Külső hivatkozási szám` field.

V1 deliberately does **not** extract that field as `order_id`, because its semantics belong to the merchant integration and can represent different merchant-side references. Treating it as a universal order number would create unsafe cross-system links.

## PAYMENT_FAILED / PAYMENT_ACTION_REQUIRED

SimplePay officially supports successful and unsuccessful transaction outcomes and documents unsuccessful testing in Sandbox.

However, this research round found no direct authenticated recipient email from `noreply@simplepay.hu` that safely establishes a stable failed-payment or action-required email template.

Therefore V1 contains **no**:

- `PAYMENT_FAILED` rule;
- `PAYMENT_ACTION_REQUIRED` rule.

Merchant emails mentioning a failed SimplePay attempt are not promoted to direct payment-provider authority.

## REFUNDED

No direct authenticated SimplePay refund-completion recipient email was verified in this research round.

Therefore V1 contains no `REFUNDED` rule. A successful payment receipt never implies anything about a later refund.

## Hard negatives

Regression coverage includes:

- success-like subject without transaction ID / paid amount / explicit success body;
- Simple/`simpleapp.hu` promotional mail;
- lookalike/spoof DKIM domain;
- synthetic failed/action-required/refund subjects, which intentionally produce no V1 evidence;
- external merchant reference must remain `order_id = null`;
- non-purchase payment contexts still produce only payment evidence and remain blocked from purchase creation/automatic linking.

## Production gate

This profile remains in `test-registry.ts` only.

Before any future production promotion:

1. live ingestion must reliably expose authenticated DKIM-domain evidence;
2. failed/action-required/refund email families need direct provider evidence before adding those states;
3. merchant-specific external-reference semantics must be verified before automatic purchase linking;
4. positive and hard-negative regressions must remain green.
