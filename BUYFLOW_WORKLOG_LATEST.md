# BuyFlow worklog latest

Current TechnicalEvidence branch: `codex/technical-evidence-shadow-v1`

Development PR: #256 -> `codex/mailgun-inbound-shadow-v3`

Mode: shadow/read-only, 0 production writes, 0 AI calls, no runtime/DB/Purchase Identity Graph authority.

## 2026-08-24 — Direction Gate + Packeta R1

### Retro-200 frozen historical benchmark

Ground truth:
- total: 200
- commerce: 33
- noise: 167

This is regression/generalization characterization only, NOT fresh blind accuracy.

### Direction Gate v1

The Source Role / Direction Gate removed the known seller-side / return-to-seller carrier false positives from buyer-Purchase authority while preserving audit evidence.

After gate:
- Event: TP 2 / FP 0 / FN 31 / TN 167, precision 100%, recall 6.06%
- Actionable TE: TP 5 / FP 0 / FN 28 / TN 167, precision 100%, recall 15.15%
- known actionable FP: **10 -> 0**

### Packeta R1

Strict Packeta carrier TechnicalEvidence added to `technical-evidence-carrier-v1.ts` and covered through executable `technical-evidence-v1-5.ts`.

Authority stays narrow:
- exact direct `packeta.hu` sender only;
- marketing subdomains rejected;
- PACKETA namespace;
- hard Z id requires >=2 agreeing provider/template primitives;
- conflicting Z ids fail closed;
- single Z-looking token/url insufficient;
- shipment event requires exact accepted-for-transport subject + buyer-bound shipment semantics + Packeta tracking endpoint.

Frozen retro sender cardinality:
- Mixed 100: 1 direct Packeta
- NoiseEnriched 100: 0 direct Packeta
- 199/200 cases invariant to the adapter delta.

Targeted retro result after Direction Gate + Packeta R1:
- Event: **TP 3 / FP 0 / FN 30 / TN 167**, precision **100%**, recall **9.09%**, F1 **16.67%**
- Actionable TE: **TP 6 / FP 0 / FN 27 / TN 167**, precision **100%**, recall **18.18%**, F1 **30.77%**
- known FP remains **0**

Report:
`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-2026-08-24.md`

### CI

CI-only draft PR #262 executed GitHub Actions run #955 and was then closed without merge.

Validated head:
`7192bd438876464e7201c342df1296c64a790b3b`

PASS:
- API typecheck
- API tests **1101/1101**
- API build
- mobile typecheck
- mobile web build

Dependency note: `npm install` reports 3 high-severity audit findings; separate release-hardening task, not a semantic test failure.

### Active future blind protocol

`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V3-2026-08-24.md`

Freeze snapshot:
`ca3ae62b358f7b7cdcde63a6e1c0960c54b49513`

Cutoff:
`2026-08-23T23:28:16Z` / `2026-08-24 01:28:16 Europe/Budapest`

First ID-only Gmail preflight after cutoff: **0 messages**. No v3 candidate content inspected.

## Existing TechnicalEvidence stack retained

- v1/v1.1/v1.2 multi-layer technical evidence
- executable v1.5 composite collector
- native Shopify transactional shadow adapter
- deterministic PDF invoice evidence
- GLS COD PDF payment/parcel evidence
- DPD lifecycle/parcel semantics
- FOXPOST lifecycle/dual-id semantics
- Packeta R1 lifecycle/Z-id semantics
- Direction Gate v1
- QR policy: pickup/action-code corroboration only, never generic tracking

## Next fork

Option A — preserve Blind v3 now:
- make no evidence/authority changes;
- wait for genuinely new post-cutoff messages;
- freeze GT before exposing predictions.

Option B — continue historical recall tuning:
- next target MPL official tracking/lifecycle primitives, especially `/ugyfelszolgalat/nyomkovetes?ids=...`;
- tests + retro-200 impact + FP must remain 0 + full CI;
- then version future blind freeze forward before inspecting unseen messages.
