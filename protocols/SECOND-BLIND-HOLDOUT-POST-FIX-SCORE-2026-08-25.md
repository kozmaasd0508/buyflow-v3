# Second blind holdout — POST-FIX SCORE

Date: 2026-08-25
Frozen recognition/correlation snapshot: `18d5c82328b64fea819facaa33aded4da827db22`
Mode: read-only Gmail holdout inspection + deterministic code-path verification
Production writes: 0
BuyFlow AI calls: 0

> This is a new, previously unopened subset. Candidate message identifiers and user mail content are intentionally not committed. This score is immutable and must not be rewritten after later fixes.

## Headline

The generic non-final acknowledgement safety fix passed full API/mobile CI before this holdout subset was opened.

Four useful, previously unprofiled lifecycle situations were found:

| Case | Ground truth | Frozen v2 result | Safety |
|---|---|---|---|
| A | accepted order -> completed courier handoff, same merchant sender namespace + exact order id | automatic create + exact link | PASS |
| B | accepted order -> message says courier handoff will happen later that day | future handoff remains non-shipment | PASS / conservative |
| C | accepted order -> later shipped message with exact order id + tracking id, but unfamiliar translated shipment wording | shipment event not confidently recognized | SAFE MISS |
| D | accepted storefront order -> later shipment uses related infrastructure identity whose merchant authority is not proven | no unsafe merchant-namespace bridge | SAFE MISS |

### Post-fix score

- useful unknown-merchant lifecycle cases: **4**
- safe complete automatic E2E: **1 / 4**
- conservative safety controls: **1 / 4**
- safe misses: **2 / 4**
- unsafe Purchase creation: **0**
- wrong automatic links observed: **0**
- unsafe cross-merchant merges observed: **0**

## Decision

The unsafe acknowledgement pattern found in the previous frozen score is no longer represented by an open safety hole in this fresh subset. The post-fix holdout remains fail-closed and contains one real automatic unknown-merchant E2E success.

The next safest recall improvement is **not** to weaken merchant identity. It is to handle generic shipped wording only when corroborated by independent shipment evidence such as a tracking identifier. Storefront/infrastructure merchant bridging remains out of scope until explicit identity evidence exists.
