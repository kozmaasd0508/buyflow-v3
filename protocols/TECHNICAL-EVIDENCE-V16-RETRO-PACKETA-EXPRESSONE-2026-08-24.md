# TechnicalEvidence v1.6 — retro Packeta + Express One expansion

**Date:** 2026-08-24 Europe/Budapest  
**Branch:** `codex/technical-evidence-v16-retro`  
**Base:** frozen executable v1.5 `af13bc7dbc54f24e2a730577c451198a031a6bdf`  
**Mode:** RETRO DEVELOPMENT ONLY · SHADOW · 0 WRITE · 0 AI

## Why v1.6 is separate

Blind Holdout v2 keeps executable v1.5 frozen. v1.6 is a separate retro-development lane and does not alter the v1.5 blind candidate.

The historical 200-message Gmail set exposed two high-value provider gaps: native Packeta and native Express One carrier namespace/lifecycle evidence.

## Packeta finding

A real historical Packeta recipient notification provides a multi-layer stack:
- visible sender `noreply@packeta.hu`;
- DKIM pass for Packeta infrastructure/root and DMARC pass for `packeta.hu`;
- explicit labelled `Csomagszám` in `Z...` format;
- official `tracking.packeta.com/?id=Z...` URL;
- exact current lifecycle wording saying the sender has now handed/shipped the parcel into the Packeta delivery flow.

v1.6 rules:
- require sender domain + stored DKIM/DMARC pass agreement;
- require explicit Packeta parcel identity (labelled `Z...` or official tracking URL);
- namespace parcel identity as `PACKETA`;
- emit `shipment` only for the exact accepted-for-transport recipient template;
- do NOT promote the carrier email's merchant order number to merchant-scoped hard Purchase identity;
- generic `?id=` links outside `tracking.packeta.com` have no Packeta identity meaning.

## Express One finding

Historical plus previously reviewed real messages prove a stable lifecycle:
- central-warehouse physical inbound / processing started;
- courier took parcel for today's delivery;
- delivered confirmation.

Stable machine/technical evidence includes:
- sender `@expressone.hu`;
- DKIM/DMARC pass for `expressone.hu`;
- long explicit shipment/waybill identifier;
- Hungarian `küldeményszám (fuvarlevélszám)` label and/or English `air waybill` / `shipment ID` labels;
- delivered mail may additionally expose official `tracking.expressone.hu/?trackingNr=<waybill>`.

v1.6 rules:
- require sender domain + stored DKIM/DMARC pass agreement;
- namespace long explicit waybill as `EXPRESS_ONE`;
- physical inbound -> broad `shipment` event with `expressone_physical_inbound_template` qualifier;
- today's delivery -> broad `shipment` event with `expressone_out_for_delivery_template` qualifier;
- delivered -> `delivery` event with `expressone_delivered_template` qualifier;
- opaque `tracking.expressone.hu/?h=...` redirect token is explicitly NOT shipment identity;
- `trackingNr` is accepted only on the official Express One tracking host and only in the provider-authenticated context.

## New code

- `apps/api/src/extraction-v2/technical-evidence-carrier-v16.ts`
- `apps/api/src/extraction-v2/technical-evidence-carrier-v16.test.ts`
- `apps/api/src/extraction-v2/technical-evidence-v1-6.ts`
- `apps/api/src/extraction-v2/technical-evidence-v1-6.test.ts`

Executable v1.6 composes frozen v1.5 plus only the new Packeta/Express One provider-qualified evidence. It does not modify `technical-evidence-v1-5.ts`.

## Fail-closed regressions

Tests reject:
- forged Packeta/Express One From with failed authentication;
- Packeta-like `Z...` id on a generic host;
- Express One opaque `h=` redirect as tracking identity;
- `trackingNr` on a non-Express-One host;
- unrelated authenticated newsletter/noise as Packeta/Express One namespace.

## Exact CI

Exact v1.6 development head:

`519eafd13f7ff6f1a9a154495a9e6444f8254bcc`

Temporary CI-only PR #259, GitHub Actions run #944:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

The CI-only PR is not for merge. Production remains unchanged.

## Additional retro observation

REGIO JÁTÉK real order mail exposes a stable `SiteEngine(c)GreyMatter` MIME boundary plus an independently authenticated merchant domain and a three-message order lifecycle. This is a next research candidate, not yet lifecycle authority: one merchant family alone is insufficient for general platform authority.

## Next

Continue retro characterization without touching frozen v1.5:
1. classify remaining retro commerce families by engine/provider;
2. seek a second independent `SiteEngine(c)GreyMatter` merchant before platform-general lifecycle authority;
3. audit hard-noise false-positive traps from the 200-set;
4. keep Blind Holdout v2 future traffic untouched for the actual unbiased gate.
