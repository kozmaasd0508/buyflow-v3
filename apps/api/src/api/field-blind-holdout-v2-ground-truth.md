# Blind Field Holdout v2 — Ground Truth Freeze

Status: FROZEN BEFORE FIRST MOTOR RUN
Mode: SHADOW · 0 WRITE · 0 AI

This holdout was selected after the Blind v1 generalization fixes. Ground truth must be derived from the original mailbox message, never from parser output. Unknown/unproven fields remain not_asserted. Do not edit expected values after the first motor run; corrections require a new version with an audit note.

## Frozen Gmail set

### Commerce (6)
- 19feb646e0160ca7
- 19feaf982b637504
- 19fd5e309b403641
- 19fce434814a5ebf
- 19fcc8874f657138
- 19fc7bb6c2fcb815

### Hard noise (10)
- 1a01e5a22617a76d
- 1a01b363800e92d0
- 1a0123667ed47ccf
- 1a009fd96cc7eb43
- 19ffa16e809a4a47
- 19ff28a9a5531c8a
- 19fdb8a6f954adb4
- 19fd1ff082a80067
- 19fce5cf24baf31e
- 19fca841993ae749

## Scoring contract

Detection truth is frozen by the Commerce/Hard noise lists above.

For commerce messages, field assertions are recorded only when directly supported by the original message. Fields: eventType, merchant, orderNumber, total, currency, carrier, trackingNumber, paymentStatus, products. Any field not independently established from the source is `not_asserted`; absence must not be inferred from parser output.

## Anti-overfitting rule

No parser/detector modification is allowed between freezing this file and recording the first Blind v2 result. The first result is permanent baseline evidence. Blind v1 fixtures may be used only as regression tests, never as evidence for v2 generalization.
