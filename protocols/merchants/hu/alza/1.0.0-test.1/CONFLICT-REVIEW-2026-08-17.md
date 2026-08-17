# Alza Hungary — 7-conflict review

Status date: **2026-08-17**

This review closes the seven semantic conflicts attributed to `merchant.hu.alza@1.0.0-test.1` in the 2026-08-17 read-only cross-parser mailbox audit.

## Safety scope

- Read-only evidence review only.
- No Alza profile is added to the production registry.
- No Purchase, shipment, document, payment, return or refund write is enabled.
- No database schema or runtime write gate is changed.

## Root cause

The seven audit conflicts are explained by **multi-event Alza finalization messages** versus a comparator built around legacy parsers that return one primary commerce result per message.

Observed Alza final-stage messages can independently prove both:

- a logistics state such as `SHIPPED` or `READY_FOR_PICKUP`; and
- `INVOICE`, but only when the message contains the explicit `Számla letöltése` Alza PDF link **and** wording that Alza accepted the order and a contract was formed.

The protocol shadow deliberately emits those as separate evidence rows. The legacy `parseDeterministicCommerceEmail()` path returns a single primary commerce parse result. For an AlzaBox-ready message, `parseAlzaCommerceEmail()` returns `ready_for_pickup`; therefore the independent protocol `INVOICE` row has no matching legacy `INVOICE` event and the one-off consensus comparator labels that row a conflict.

The same single-result limitation applies when a final carrier-handoff message also contains final invoice/contract evidence.

This is a **comparator representation difference**, not evidence that the protocol is inventing a lifecycle state.

## Direct Gmail validation

Direct recipient-email review on 2026-08-17 confirmed the combined finalization family on both AlzaBox-ready and DPD-handoff mail:

- authenticated sender channel: `segito@alza.hu`;
- explicit order identity;
- explicit logistics evidence;
- an Alza `Apps/pdfdoc.asp?d=AHUW...` invoice-download URL;
- explicit wording that Alza accepted the order and the contract was formed.

A current Gmail search contains multiple examples of this combined template family. Private message IDs, addresses, phone numbers, pickup codes, order numbers, tracking numbers and invoice numbers are intentionally not stored in this review.

## Important boundaries that remain unchanged

- Initial `Köszönjük ... megrendelésed` receipt remains `ORDER_CREATED`, even though the legal contract is not yet formed.
- Processing remains `ORDER_PROCESSING`, not `SHIPPED`; an invoice-looking link during processing is insufficient for `INVOICE` while the message still says no contract exists.
- Bank-transfer instructions remain `PAYMENT_ACTION_REQUIRED`, not `PAYMENT_FAILED` or `PAYMENT_SUCCESS`.
- Unpaid cancellation is `CANCELLED`; lack of payment does not prove a failed payment transaction.
- DPD handoff is `SHIPPED` only with explicit handoff + DPD + tracking evidence.
- AlzaBox arrival is `READY_FOR_PICKUP`, never `DELIVERED`, and may still be unpaid.
- Return request remains `OTHER` until physical return receipt.
- `RETURN` and `REFUNDED` remain separate stages.

## Closure decision

The seven overlap conflicts are reviewed as non-dangerous multi-event/single-result comparator differences. The protocol keeps the stricter event boundaries above and does not collapse document evidence into logistics state.

`merchant.hu.alza` is therefore eligible to move from **YELLOW** to **GREEN production-shadow candidate** status. GREEN authorizes observations/counters only; it does not authorize production writes.

Any future Alza conflict involving a different semantic boundary, especially `ORDER_CREATED`, payment state, physical carrier handoff, delivery, return or refund, re-opens the promotion gate.

## Regression coverage

A dedicated regression test demonstrates the reviewed mechanism on an AlzaBox finalization message: protocol shadow emits both `READY_FOR_PICKUP` and `INVOICE`, while the legacy deterministic commerce parser returns the primary `ready_for_pickup` commerce result. Existing Alza profile tests separately preserve the shipped+invoice, processing/no-invoice, payment-action, cancellation, return and refund boundaries.
