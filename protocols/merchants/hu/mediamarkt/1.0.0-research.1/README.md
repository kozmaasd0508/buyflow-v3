# MediaMarkt Hungary — merchant research profile 1.0.0-research.1

Status: **research / shadow only**

This profile intentionally does **not** claim a verified recipient email template. The connected Gmail mailbox contained no direct MediaMarkt transactional order email during the 2026-08-16 research round, so sender address, DKIM, Return-Path and exact subject/body wording remain unverified.

## What official MediaMarkt documentation proves

### 1. Order receipt acknowledgement is not order acceptance

The current MediaMarkt Hungary web-shop terms state that the first automatically generated email only confirms that the customer's order has arrived at MediaMarkt. That first acknowledgement does not mean MediaMarkt accepted the offer.

A separate later email communicates acceptance; the contract is formed only at that later step.

BuyFlow consequence:

- first receipt acknowledgement must not automatically create a purchase in production;
- do not collapse the first acknowledgement and the later acceptance into one universal `ORDER_CREATED` template;
- wait for a verified direct recipient example before implementing positive creation logic.

Official source:
- https://www.mediamarkt.hu/hu/legal/aszf/aszf

### 2. Physical handoff to logistics partner is a real shipment boundary

MediaMarkt states that after the order is prepared and handed to its logistics partner, its system sends another electronic notification. That notification contains a parcel identifier and a tracking link.

Research mapping:

`merchant handoff + parcel/tracking evidence -> SHIPPED candidate`

But this is still merchant authority, so direct carrier evidence remains stronger. Because the exact email template and authentication channel are unverified, the research candidate carries `DO_NOT_SET_SHIPPED_AT` and cannot enter production decisions.

Official sources:
- https://info.mediamarkt.hu/app/answers/detail/a_id/15891/~/mikor-kapom-meg-a-rendel%C3%A9semet%3F
- https://www.mediamarkt.hu/hu/service/hazhoz-szallitas

### 3. Store pickup readiness is not delivery

For store pickup, MediaMarkt sends an email when the order has been prepared and can be collected. MediaMarkt's pickup service documents an `Időpontot foglalok` action in the preparation notification. The current terms also require the customer to present the pickup notification / QR code at the store.

Research mapping:

`prepared / ready at store -> READY_FOR_PICKUP`

Never map this to `DELIVERED`.

Official sources:
- https://www.mediamarkt.hu/hu/service/rendeles_atveteli_idoponttal
- https://www.mediamarkt.hu/hu/legal/aszf/aszf

### 4. Web invoice authority is separate

MediaMarkt says web-shop electronic invoices are sent as PDF at logistics handoff and the sender is **Számlaközpont Zrt.** Store-pickup purchases receive the purchase invoice in the store.

BuyFlow consequence:

- do not make arbitrary `@mediamarkt.hu` mail direct invoice-provider authority;
- invoice parsing should eventually use a separate Számlaközpont channel/profile or the PDF itself.

Official source:
- https://info.mediamarkt.hu/app/answers/detail/a_id/15867/~/mikor-kapom-meg-a-sz%C3%A1ml%C3%A1t%3F

### 5. Online card payment authority is separate

MediaMarkt lists **SimplePay** as the partner responsible for online bank/card payment transaction security.

BuyFlow consequence:

- direct SimplePay evidence is higher payment authority than MediaMarkt merchant wording;
- no MediaMarkt `PAYMENT_SUCCESS` rule is added here.

Official source:
- https://www.mediamarkt.hu/hu/service/fizetesi-lehetosegek

### 6. Return/cancellation/refund words are not settled refund proof

MediaMarkt documents cancellation and a 30-day return process. Online purchase refunds are returned to the original payment instrument under the documented return process.

No direct recipient cancellation/return/refund email template was verified in the connected mailbox, so this profile implements no positive `CANCELLED`, `RETURN` or `REFUNDED` rule.

Official sources:
- https://www.mediamarkt.hu/hu/service/gyartoi-garancia-es-elallas
- https://info.mediamarkt.hu/app/answers/detail/a_id/21262/~/hogyan-t%C3%B6rt%C3%A9nik-a-v%C3%A9tel%C3%A1r-visszat%C3%A9r%C3%ADt%C3%A9se-a-30-napos-visszav%C3%A9teln%C3%A9l%3F

## Gmail research result

Search rounds included MediaMarkt sender/domain and transaction/lifecycle terms. No direct MediaMarkt recipient transaction message was found in the connected mailbox. A Simple promotional email mentioning MediaMarkt was found, but it is not MediaMarkt merchant authority and is not used as a positive template.

Therefore this profile deliberately has:

- `status: research`;
- no verified sender address;
- no DKIM / Return-Path requirement yet, because those values have not been observed from a real transaction message;
- no identifier extraction;
- no positive order acceptance, payment, invoice, cancellation, return, refund or delivery parser;
- only conservative research candidates for first acknowledgement, logistics handoff and store-pickup readiness.

## Upgrade criteria to test status

Do not promote this profile from `research` to `test` until at least one direct recipient message is captured for the relevant event and its raw MIME verifies:

1. exact From address or stable sender family;
2. sender domain;
3. DKIM signing domain;
4. Return-Path / transport characteristics where useful;
5. exact subject/body structure;
6. stable order / parcel identifiers if exposed;
7. positive and hard-negative regression cases.

Production registry remains unchanged and empty.
