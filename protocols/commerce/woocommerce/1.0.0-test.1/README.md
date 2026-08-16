# WooCommerce Protocol — 1.0.0-test.1

Status: `test` / shadow only.

This stage promotes the already source-verified WooCommerce core default-template rules from research into an isolated executable test profile. It does not register WooCommerce in the production protocol registry and does not change live BuyFlow recognition or database writes.

## What the shadow profile can test

- Processing order -> `ORDER_PROCESSING`
- Failed order -> `PAYMENT_FAILED`
- Customer cancelled order -> `CANCELLED`
- Explicit order payment/retry request -> `PAYMENT_ACTION_REQUIRED`
- Full/partial merchant refund -> `REFUNDED` candidate with `DO_NOT_MARK_REFUNDED`
- Fulfillment-created -> `SHIPPED` evidence with `DO_NOT_MARK_DELIVERED`

## Safety contract

- Production registry remains empty.
- `status=test` means evidence is never `production_eligible`.
- Lifecycle-only evidence cannot create a Purchase where `DO_NOT_CREATE_PURCHASE` applies.
- Merchant refund wording cannot finalize settled refund.
- Fulfillment cannot become delivered.
- WooCommerce Completed remains intentionally unmapped.
- Default-looking subject without the verified body structure must not match.

## Promotion blockers

Do not promote this profile to production until observed rendered customer emails and hard negatives validate the default-template fingerprints across realistic stores/locales, and the permanent benchmarks remain at zero unsafe Purchase creation, zero wrong identity/linking and zero unsafe lifecycle promotion.
