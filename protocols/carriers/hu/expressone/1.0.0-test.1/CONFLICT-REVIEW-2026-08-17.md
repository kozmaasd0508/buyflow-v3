# Express One Hungary — 2-conflict review

Status date: **2026-08-17**

This review closes the two semantic conflicts attributed to `carrier.hu.expressone@1.0.0-test.1` in the 2026-08-17 read-only cross-parser mailbox audit.

## Safety scope

- Read-only evidence review only.
- No Express One profile is added to the production registry.
- No Purchase, shipment, delivery, payment or document write is enabled.
- No database schema or runtime write gate is changed.

## What the two conflicts are

Direct Gmail review reproduced **exactly two** messages in the audit window with the current recipient pre-advice subject:

`Előzetes értesítés csomag érkezéséről`

Both messages explicitly state that the sender has only notified Express One about the shipment and that:

`A küldemény átadása futárszolgálatunk részére még nem történt meg.`

The same template later contains future-looking delivery-planning text, including a `kézbesítés várható` phrase and a warning that a separate notification will be sent on the morning of the actual delivery.

Private message IDs, recipient data, addresses, shipment numbers, merchant names, amounts and contact details are intentionally not stored in this review.

## Adjudication

| Layer | Result |
|---|---|
| Express One protocol shadow | `SHIPMENT_CREATED` |
| Generic deterministic carrier comparator | `OUT_FOR_DELIVERY` |
| Reviewed meaning | **`SHIPMENT_CREATED`** |

The generic carrier comparator contains a broad `kézbesítés várható` future-delivery pattern and evaluates it before generic pre-advice patterns. On this current Express One email generation, that phrase appears inside explanatory future-delivery text even though the same email explicitly says physical handoff has **not** happened.

The direct negative handoff statement is authoritative for this boundary:

`SHIPMENT_CREATED != SHIPPED != IN_TRANSIT != OUT_FOR_DELIVERY`

## Why the protocol result is safer

The Express One profile requires all of the following for this event:

- authenticated `expressone.hu` channel;
- exact current pre-advice subject;
- sender-notified wording;
- explicit `még nem történt meg` courier-handoff denial;
- explicit Express One shipment number.

It therefore does not infer physical carrier possession from an estimated delivery paragraph.

Later Express One messages remain separate direct evidence:

- central-warehouse physical inbound → `IN_TRANSIT`;
- courier takes the parcel for same-day delivery → `OUT_FOR_DELIVERY`;
- delay/revised ETA → `DELAYED`;
- explicit handover timestamp → `DELIVERED`.

Sender-side eBox pickup-booking mail remains outside this recipient profile.

## Closure decision

Both Express One conflicts are reviewed as the same non-dangerous generic-parser over-promotion on current pre-advice mail. The protocol result remains `SHIPMENT_CREATED` and its no-write/no-progress prohibitions remain mandatory.

Express One was already a **GREEN production-shadow candidate** because the profile has a direct full recipient lifecycle and the two audit differences were known to sit on this conservative pre-advice/physical-progress boundary. This review formally closes those two rows; it does not change the GREEN count and does not enable writes.

Any future conflict outside this reviewed pre-advice fingerprint re-opens the gate.

## Regression coverage

A dedicated regression test pins the current pre-advice wording to `SHIPMENT_CREATED` in protocol shadow and documents that the standalone generic deterministic carrier comparator promotes the same fixture to `out_for_delivery` because of future-delivery wording.
