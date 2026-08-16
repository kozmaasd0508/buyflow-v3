# Shoprenter — 1.0.0-test.3

Status: `test` / shadow only.

## Change from test.2

A fourth real Shoprenter merchant investigation (Forproshop) exposed another rendered order-confirmation copy variant on the already verified `*.smtp.shoprenter.hu` route.

Observed order-state copy now includes both:

- `Megrendelése megérkezett, feldolgozása elkezdődött`
- `Megrendelése megérkezett és feldolgozása megkezdődött`

Both forms still require verified Shoprenter infrastructure, the rendered order-detail structure and a stable order identity. The generic platform profile still enables only `ORDER_CREATED`.

## Four-merchant status safety boundary

Observed merchant-specific journeys now cover:

- Gyerekjatekbolt
- Home Automatica
- WebArena
- Forproshop

These examples show why Shoprenter status labels must not be mapped globally.

Examples observed in real merchant mail include:

- `Szállítás alatt`
- `Elküldve`
- `Teljesítve`
- `Jóváírás`
- `Rendelése elkészült - szállítás folyamatban`

A label alone is not proof of physical courier handoff, in-transit movement, delivery, settled refund or accepted payment.

The regression suite therefore enforces a default safety boundary: status-only merchant mail must not produce `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `DELIVERED` or `REFUNDED` unless a separately verified merchant/direct-provider rule supplies stronger evidence.

## Strong Forproshop counterexample

Forproshop sent `Rendelése elkészült - szállítás folyamatban` shortly after a direct FOXPOST pre-advice for the same observed journey.

The FOXPOST message explicitly stated that a parcel number had been created but the parcel had **not yet been handed to FOXPOST**.

Therefore the merchant label cannot safely mean `SHIPPED`.

Later, FOXPOST sent a ready-for-pickup notification. The merchant subsequently sent `Teljesítve`, but the inspected merchant email itself still contained no direct carrier proof of pickup or delivery. `Teljesítve` therefore remains merchant-specific and must not be globally mapped to `DELIVERED`.

## Safety

- production registry remains unchanged and empty
- profile status stays `test`
- no live Purchase/Shipment/Document writes
- no AI inference
- no database migration
- no private customer data or real identifiers are committed in fixtures
- exact Shoprenter-owned infrastructure patterns are anchored; lookalike domains must not match
