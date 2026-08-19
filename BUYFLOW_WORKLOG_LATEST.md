# BuyFlow worklog latest

Provider adapters v6 branch created for FOXPOST, MPL/Posta, Packeta and Gate lifecycle coverage plus explicit payment_failed semantics and support/reply safety guardrails. This branch starts from codex/mailgun-inbound-shadow-v3 and keeps v4 holdout frozen for regression only.

Planned v6 release gate: precision 100%, recall >=95%, false positives 0, semantic-critical errors 0.

Next implementation step: wire provider-specific lifecycle adapters into the normalized inbound pipeline before generic fallback, with strict sender-domain gating and no production writes during validation.

Status: branch is isolated and safe for implementation; no production path has been promoted or enabled.

Do not modify v4 ground truth while implementing v6; v4 remains regression-only evidence.
