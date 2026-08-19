# BuyFlow worklog latest

Provider adapters v6 branch created for FOXPOST, MPL/Posta, Packeta and Gate lifecycle coverage plus explicit payment_failed semantics and support/reply safety guardrails. This branch starts from codex/mailgun-inbound-shadow-v3 and keeps v4 holdout frozen for regression only.

Planned v6 release gate: precision 100%, recall >=95%, false positives 0, semantic-critical errors 0.

Next implementation step: wire provider-specific lifecycle adapters into the normalized inbound pipeline before generic fallback, with strict sender-domain gating and no production writes during validation.

Status: branch is isolated and safe for implementation; no production path has been promoted or enabled.

Do not modify v4 ground truth while implementing v6; v4 remains regression-only evidence.

Implementation targets from v4: FOXPOST arrival/warehouse/return, MPL/Posta posted/out-for-delivery/pickup, Packeta accepted-for-transport, Gate order/shipment, explicit payment_failed, support/reply guardrail.

No generic keyword broadening is allowed unless backed by a noise regression case.

Provider adapters must require an exact trusted sender domain plus lifecycle evidence; generic promotion remains fallback-only.

Semantic invariant: failed/declined/unsuccessful payment evidence must never map to payment_completed.

Support/reply messages without deterministic purchase lifecycle evidence stay review/ignored; no sender-only promotion.

Implementation should preserve 0 production writes and 0 AI calls until regression and fresh holdout gates pass.

Branch tip is ready for code changes.
