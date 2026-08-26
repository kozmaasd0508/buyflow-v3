# Phase E — 100 real lifecycle V4 first score

Date: 2026-08-26
Mode: private read-only Gmail/Nylas shadow audit
Status: **FAIL — unsafe cases require diagnosis before any production change**

This file records the first V4 score before any diagnosis or fix. It must not be rewritten to replace the first result.

## CI evidence

- CI run number: 1059
- GitHub Actions run id: 32969553513
- Normal API typecheck: PASS
- Normal API tests: **1242 / 1242 PASS**
- Audit step: FAIL by design because the first score contained unsafe flags

## Frozen selection

- qualifying order roots: **100**
- source candidates scanned: **1065**
- unique source candidates: **974**
- discovered lifecycle messages: **328**
- chains with more than one message: **69**
- chains with at least three messages: **54**

The fixed primary `category:purchases` source was sufficient to reach 100 roots under V4; fallback subject sources were therefore not used.

## First score

- automatic Purchase creates: **18**
- automatic lifecycle links: **11**
- blocked decisions: **299**
- chains with a simulated Purchase: **16**
- chains with at least one automatic lifecycle link: **9**
- suspected wrong automatic links: **3**
- duplicate automatic Purchase creates: **0**
- automatic creates on explicit non-acceptance: **0**
- final cross-chain merged Purchases: **0**
- production writes: **0**
- AI calls: **0**

Two create events also lacked a unique benchmark-chain owner. These produced paired graph-delta safety flags. They may represent benchmark chain overlap or a real correlation problem and are not dismissed without diagnosis.

## Interpretation

This is not a passing promotion-readiness result. The three suspected cross-chain automatic LINKED decisions and the two non-unique create ownership cases must be diagnosed on the exact same frozen population before any production change.

No raw Gmail ids, subjects, bodies, sender addresses, order numbers, tracking numbers, payment references, recipient data, or other private transaction values are stored in this protocol.