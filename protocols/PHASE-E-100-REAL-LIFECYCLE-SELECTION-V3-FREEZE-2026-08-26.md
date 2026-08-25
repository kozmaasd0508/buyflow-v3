# Phase E — 100 real lifecycle learning — selection v3 freeze

Date: 2026-08-26
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

This revision changes only audit chain discovery. Production extraction, correlation and promotion-readiness remain untouched.

## Frozen source

`after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`

Scan at most the first 1200 candidates (the provider currently returns 1065 in this window).

## Chain anchor

Take the first 100 unique exact-order groups for which the anchor message has:
- an explicit stable order identity;
- a non-carrier, non-public-mailbox, non-shared-platform sender domain;
- no obvious subscription/digital-only context;
- substantive commerce structure: order-summary section, product evidence, payment/shipping section, parsed shipping/payment method, or multiple monetary transaction signals.

The anchor does not need order-created or physical-shipping semantics. It is only a key for exact lifecycle discovery.

Uniqueness remains `sender-domain namespace + normalized order identity`.

## Lifecycle proof

After selection, each chain is expanded only through exact order identities and exact tracking identities as frozen previously. A chain is useful even if its anchor is a processing/payment/status message because the exact search can recover earlier confirmation and later fulfillment messages.

## Safety

All previous hard failure conditions remain unchanged: zero cross-chain automatic links/merges, zero duplicate creates, zero creates on explicit non-acceptance, zero writes, zero AI.

If fewer than 100 roots qualify, this revision also remains a selection preflight and is recorded without calling it a 100-chain score.