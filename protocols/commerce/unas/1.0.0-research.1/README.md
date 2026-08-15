# UNAS protocol research — 1.0.0-research.1

Status: **research**. No production raw-email parser is enabled in V1.

## Core finding

UNAS is highly configurable at the email and order-status level. Stores can edit notification content, choose whether status changes send an email, define custom order statuses and send additional custom emails from an order. Because of that, a global subject/keyword dictionary would be unsafe.

The strongest platform-level knowledge is instead structural: UNAS documents stable placeholders and order fields that can appear in order/status emails.

## Verified structural fields

Official UNAS documentation exposes these useful email placeholders:

- `[order_key]` — order identifier
- `[order_amount]` / `[order_total]` — order total
- `[order_status]` — current merchant-defined order status
- `[url_track]` — webshop order tracking page
- `[url_payment]` — direct order payment/retry URL
- `[order_package_number]` — package/tracking number where supported
- `[order_products]` — order product block

These are template variables. The rendered customer email does not contain the literal square-bracket token, so they are research evidence about possible structure, not raw-email regexes by themselves.

## Order creation

UNAS can send the original order notification to the customer and administrator. The API also exposes controls for sending the original order email.

Safe BuyFlow interpretation:
- source event can support `ORDER_CREATED`;
- Purchase creation still requires verified merchant identity and a stable explicit order id;
- the raw subject is not globally trusted because the notification is editable.

## Status emails

UNAS supports status-change notification emails and lets merchants create their own statuses. Statuses have broad types such as open, successfully closed, unsuccessfully closed and outside-processing, but visible status names are merchant-defined.

Therefore:
- a generic UNAS status-change email is lifecycle evidence;
- it is **not** globally mapped to `ORDER_PROCESSING`, `SHIPPED`, `DELIVERED`, etc.;
- each merchant/status mapping must be explicitly verified before it can produce a canonical lifecycle candidate.

A merchant can also manually send the status notification, so email occurrence alone does not prove a unique external event.

## Payment

UNAS documents a failed/pending-payment notification family and exposes order id/total placeholders for it. It also records card-payment outcomes from bank feedback in the order payment details.

Safety:
- the notification-family label combines failed and pending states, so it is too broad for an automatic `PAYMENT_FAILED` rule;
- `[url_payment]` may provide a payment/retry action but its presence alone is not a successful/failed payment state;
- direct payment-provider state remains stronger.

## Shipment / tracking

UNAS can place package number and clickable tracking in status notifications for supported shipping methods. Official docs list support for several carriers including GLS, DPD, Express One, MPL and Foxpost variants.

This is excellent identity evidence, but not physical-progress evidence:
- package number/tracking URL can safely help match a Shipment;
- it cannot by itself set `shipped_at`, `IN_TRANSIT`, `OUT_FOR_DELIVERY` or `DELIVERED`;
- direct carrier evidence remains authoritative for physical state.

## Invoice state

UNAS order/status data includes invoice-state values such as not billable, billable and billed. This is administrative state, not proof of a specific fiscal invoice PDF or provider document.

BuyFlow should continue to require invoice-provider/PDF evidence for canonical document identity.

## Hard-negative families

The same UNAS notification system also supports unrelated emails such as:
- registration/data change
- account deletion
- new password
- newsletter subscribe/unsubscribe
- stock availability notification
- price-drop notification
- manually composed customer email / newsletter-template email

These must never become purchase lifecycle events merely because they come from the same merchant/store.

## Why V1 has no executable raw-email profile

UNAS does not provide a single safe shared sender identity or immutable rendered subject/body fingerprint. Merchant customization is part of the normal platform behavior.

V1 therefore stores:
- verified platform capabilities
- structural placeholders
- event semantics
- safety prohibitions

A raw parser should be added only after observed real UNAS emails or first-party rendered default templates can establish source-backed fingerprints.

## Primary sources

- Megrendelés részletek: https://unas.hu/tudastar/admin/megrendeles-reszletek
- Értesítések: https://unas.hu/tudastar/admin/ertesitesek
- Megrendelés státuszok, típusok: https://unas.hu/tudastar/admin/megrendeles-statuszok-tipusok
- Megrendelések API adatszerkezet: https://unas.hu/tudastar/api/megrendelesek-adatszerkezet
- Megrendelés státuszok API adatszerkezet: https://unas.hu/tudastar/api/megrendeles-statuszok-adatszerkezet
- Alapbeállítások: https://unas.hu/tudastar/admin/alapbeallitasok

## Promotion blockers

Before raw-email activation:
1. obtain multiple real rendered UNAS order-confirmation and status emails;
2. verify merchant-specific status names against actual lifecycle meaning;
3. test package-number/tracking extraction without promoting physical shipment;
4. distinguish pending vs failed payment from rendered evidence;
5. add multiple notification hard negatives;
6. preserve 0 false Purchase and 0 wrong link on the permanent 100-email benchmark.
