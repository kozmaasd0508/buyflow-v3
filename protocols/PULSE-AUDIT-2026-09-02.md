# Pulse audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`

## Scope

Pulse is the user-facing Purchase status / next-step projection. There is no separate live push-notification service in the current mobile package. The audit therefore follows the status shown on the home page, Purchase cards, Purchase detail overview and timeline.

## Findings

### 1. Mobile UI independently guessed whole-Purchase state

The Purchase card used the first linked Shipment status before `purchase.currentState`. In a multi-parcel Purchase, one delivered parcel could therefore visually mark the whole Purchase delivered even while another parcel was still in transit.

### 2. Detail overview could promote uncertain data

The previous overview checked optimistic timestamps and Shipment presence before `review`/`pending`:
- `deliveredAt` alone could produce a delivered message;
- `paidAt` / payment status could produce `Fizetés rendben`;
- any Shipment could produce `A csomag úton van`;
- only `shipments[0]` was considered;
- `ready_for_pickup` was not represented as its own user-facing state.

### 3. Home counters disagreed with JourneyGraph

`MOZGÁSBAN` counted `processing` and `ordered` as moving packages while physical states such as `out_for_delivery` / `ready_for_pickup` were not consistently represented. Delivered counting also bypassed the new defensive Pulse aggregate projection.

### 4. Timeline used timestamps as promotion authority

The previous timeline could mark payment/shipping/delivery complete from timestamps even when the aggregate Purchase state was ambiguous.

## Remediation

New server-only pure projection:
`apps/api/src/api/purchase-pulse.ts`

The Purchase API now returns a bounded `pulse` object derived only from persisted Purchase state and all linked Shipment states. Pulse contains user-display semantics only; it has no email/source/provider/Purchase identity authority fields.

Safety rules:
- `review` / `pending` always beat optimistic timestamps or child Shipment hints;
- whole-Purchase `delivered` is shown only when the aggregate state is delivered and linked parcels do not contradict it;
- aggregate delivered + any undelivered parcel -> fail closed to review;
- all child parcels delivered without aggregate delivery -> fail closed to review;
- `deliveredAt` alone cannot promote delivery;
- `paidAt` alone cannot promote an `ordered` Purchase to paid;
- `ready_for_pickup` and `out_for_delivery` are explicit physical progress states;
- `movement` is true only for physical shipment progress, not `ordered` / `processing`;
- unknown states fail closed to review;
- `lastConfirmedAt` does not use generic `updatedAt` as proof.

Mobile now consumes `purchase.pulse` for:
- Purchase card badge;
- whole-Purchase detail badge;
- current status title/body/tone;
- last confirmed activity;
- home `MOZGÁSBAN` counter;
- home delivered counter;
- timeline authority.

Per-Shipment rows may still show their own Shipment status; they no longer promote the whole Purchase.

## Push notifications

No live push notification delivery dependency is present in `apps/mobile/package.json` and no push/Expo/Firebase notification sender was found in the audited source tree. This audit does not add push delivery or notification permissions.

If push notifications are added later, they must consume the same server-side Pulse projection and must never derive a notification directly from raw email, EventMind output, visible `From`, or the first Shipment alone.

## Tests

`apps/api/src/api/purchase-pulse.test.ts` covers:
- review/pending precedence;
- timestamp non-promotion;
- multi-shipment delivery contradiction;
- aggregate + parcel delivery agreement;
- child-only delivery fail-closed behavior;
- pickup / out-for-delivery states;
- physical movement counting;
- unknown-state fail-closed behavior;
- absence of email/source/identity authority fields in Pulse output.

## Verification

Final verified head:
`df75e04989afd89df080942adcf31cb4ee4ec2d4`

Initial CI #1186 / run `33660140564` stopped at API typecheck because of a test-only TypeScript cast. The test assertion was corrected; no Pulse behavior code change was required.

Final CI #1187 / run `33660311868`: **PASS**.
- EventMind runtime syntax PASS;
- EventMind launcher syntax PASS;
- API typecheck PASS;
- API tests PASS;
- API build PASS;
- mobile typecheck PASS;
- mobile web build PASS.

Temporary verification PR #309 was closed unmerged.

## Production status

Pulse read-only status authority remediation: **PASS**.

No database migration, push delivery, production write authority, provider cutover or live feature enablement was introduced by this audit.

The full module code-audit sequence is now complete:
`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`.

Production remains blocked behind the already-recorded staging migrations, real source smokes and trusted provider-authentication provenance gates.
