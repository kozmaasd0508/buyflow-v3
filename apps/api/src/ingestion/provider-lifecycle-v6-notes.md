# Provider lifecycle v6 shadow rollout

Scope: FOXPOST, MPL/Posta, Packeta, Gate, and failed-payment semantic correction.

Safety invariants:
- sender-domain + exact provider lifecycle wording for carrier rules
- failed payment must never map to `payment_completed`
- support/reply subjects do not create lifecycle evidence by themselves
- parser version `provider-lifecycle-v6-shadow` is shadow-only
- 0 production writes until regression + fresh holdout gates pass

Regression target after deploy: precision 100%, recall >=95%, FP 0, critical semantic errors 0.
