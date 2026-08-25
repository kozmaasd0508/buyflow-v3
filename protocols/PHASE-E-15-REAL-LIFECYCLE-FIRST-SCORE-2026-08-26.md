# Phase E — 15 real physical-order lifecycle blind audit — immutable first score

Date: 2026-08-26
Frozen protocol commit: `7a986ea7c458c14e5b67b30e9bca092097010384`
Audit runner head before first score: `8910627837349d5ca1af038290d3c037acf87ecb`
CI run: `#1042` (`32907207047`)
Job: `97993779016`
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

## First score

- frozen physical-order roots: **15**
- root candidate pool: **100**
- exact-evidence-discovered lifecycle messages: **73**
- promotion-eligible automatic Purchase creates: **1**
- promotion-eligible automatic lifecycle links: **0**
- blocked decisions/messages: **72**
- chains with an automatic Purchase: **1 / 15**
- chains with automatic lifecycle links: **0 / 15**
- wrong automatic cross-chain links: **0**
- duplicate automatic Purchase creates: **0**
- automatic creates on explicit non-acceptance/contract-disclaimer roots: **0**
- final cross-chain merged Purchases: **0**
- production writes: **0**
- AI calls: **0**
- unsafe conditions: **none**

## Interpretation

The first score passes the frozen precision/safety boundary but exposes a substantial recall/readiness gap. The graph did not mix independent orders, including multiple same-merchant and legally conservative acknowledgement cases, but it created only one of the 15 physical purchase roots and therefore could not automatically attach later lifecycle evidence for the other chains.

This score must not be overwritten after any fix.

## Privacy-safe observations

- Several roots were correctly blocked because the merchant explicitly stated that the first email was only an acknowledgement / did not yet establish acceptance.
- Several other merchant-owned physical order roots reached `order_created` but stayed `REVIEW` even without an explicit non-acceptance statement.
- Later exact carrier/invoice events were frequently recognized but remained `UNLINKED` because no safe Purchase existed yet.
- One parent/child-style chain stayed fully REVIEW rather than being incorrectly split or merged.
- Two separate same-merchant orders close in time remained separate; no product/time proximity merge occurred.

## Regression result

CI #1042 PASS:
- API typecheck PASS
- API tests **1237 / 1237 PASS**
- private 15-order lifecycle blind audit PASS
- API build PASS
- Mobile typecheck PASS
- Mobile web build PASS

## Next diagnostic question

Do not loosen correlation or creation safety globally. Determine why non-disclaimer merchant-owned `order_created` roots remain `REVIEW`, and separately design a generic longitudinal rule for acknowledgement-only roots where later same-order hard lifecycle evidence proves that a real purchase relationship subsequently existed. Any change must preserve this first score and rerun the same frozen 15-chain set.