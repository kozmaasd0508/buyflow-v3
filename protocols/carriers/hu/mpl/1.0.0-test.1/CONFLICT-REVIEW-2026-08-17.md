# MPL — single-conflict review

Status date: **2026-08-17**

This review closes the single semantic conflict attributed to `carrier.hu.mpl@1.0.0-test.1` in the 2026-08-17 read-only cross-parser mailbox audit.

## Safety scope

- Read-only evidence review only.
- No MPL profile is added to the production registry.
- No Purchase, shipment, delivery, payment or document write is enabled.
- No database schema or runtime write gate is changed.

## Root cause

The single conflict is the current MPL recipient template:

- sender: `kozponti.ertesites@posta.hu`
- subject: `Csomagot adtak fel neked`
- body: `Értesítünk, hogy csomagot adtak fel Neked.`
- body contains a `Csomagazonosító` and `Feladás dátuma`
- the same body says MPL will send a **later message** when the courier departs or when the parcel reaches a pickup point.

The protocol profile intentionally maps this evidence to **`SHIPMENT_CREATED`**. It proves that a tracked MPL parcel/posting record exists, but it does not prove the later physical-logistics milestone that BuyFlow uses for `SHIPPED`.

The legacy MPL branch in `deterministic-lifecycle-parser.ts` maps this same current template to `shipped`. That is the one reviewed semantic disagreement.

## Direct Gmail validation

Direct recipient Gmail review on 2026-08-17 found the current template in the audit window. The message explicitly states that a further notification will follow for courier departure or pickup-point arrival. That future-event wording supports the conservative `SHIPMENT_CREATED` interpretation and does not support fabricating a physical `shipped_at` timestamp from the posting notice.

Private recipient details, parcel identifiers, addresses, amounts and message IDs are intentionally not stored here.

## Legacy and current MPL generations

The profile deliberately supports both recipient generations:

- legacy `Csomagküldemény` / `csomagküldeményt adtak fel Önnek`;
- current `Csomagot adtak fel neked` / `csomagot adtak fel Neked`.

Both remain `SHIPMENT_CREATED` in the protocol layer. Later direct MPL messages have their own explicit meanings:

- `Csomagja/Csomagod a kézbesítőnél van` → `OUT_FOR_DELIVERY`;
- `Sikertelen kézbesítés` → `DELIVERY_FAILED`;
- `Csomagja érkezett` / `Csomagod a postán átvehető` → `READY_FOR_PICKUP`;
- explicit successful-delivery wording in the feedback mail → `DELIVERED`.

Those boundaries must remain separate.

## Closure decision

The single MPL conflict is reviewed as a legacy over-promotion of the current posting-notice template:

`SHIPMENT_CREATED != SHIPPED`

The protocol result is retained. `DO_NOT_SET_SHIPPED_AT`, `DO_NOT_MARK_IN_TRANSIT` and `DO_NOT_MARK_DELIVERED` remain mandatory on this event.

With the only audit conflict closed and both legacy/current recipient generations represented, `carrier.hu.mpl` is eligible to move from **YELLOW** to **GREEN production-shadow candidate** status. GREEN means observations/counters only and does not authorize state mutation.

Any future disagreement involving courier allocation, failed delivery, pickup-ready or delivered semantics re-opens the gate.

## Regression coverage

A dedicated regression test pins the current `Csomagot adtak fel neked` template to `SHIPMENT_CREATED` in protocol shadow while documenting that the legacy deterministic lifecycle parser still returns `shipped`. This makes the reviewed boundary explicit without weakening production logic.
