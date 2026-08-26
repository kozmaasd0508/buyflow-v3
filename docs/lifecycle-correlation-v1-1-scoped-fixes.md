# Lifecycle correlation v1.1 scoped fixes

Baseline: 76.9% correlation precision, 40.0% recall, 0 merge errors, 3 split errors, 0 noise false positives.

This change set starts with merchant identity canonicalization only. It intentionally does not relax carrier/time-window linking and does not modify production writes.

Targeted canonicalization:
- cosmetic web-domain suffixes on merchant labels (for example `gyerekjatekbolt.com` -> `gyerekjatekbolt`);
- known same-merchant storefront aliases observed in the clean holdout (`sport8` -> `forproshop`).

Safety invariant: exact normalized order number remains mandatory for these joins. Ambiguous order numbers remain REVIEW. 0 production writes, 0 AI calls.
