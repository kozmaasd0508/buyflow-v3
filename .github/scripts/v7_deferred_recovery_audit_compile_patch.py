from pathlib import Path
import sys

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
source = v7.read_text()
anchor = "import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';\n"
replacement = "import type { CanonicalEvent, PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';\n"
probe = "function recoveryAuditIdentities(event: CanonicalEvent): RecoveryAuditIdentity[]"

if anchor not in source and replacement not in source:
    raise SystemExit('v7_deferred_audit_type_import_anchor_missing')

if '--check' in sys.argv:
    if source.count(anchor) < 2 and replacement not in source:
        raise SystemExit('v7_deferred_audit_expected_new_import_occurrence_missing')
    print('v7_deferred_recovery_audit_compile_patch_check_ok')
    raise SystemExit(0)

if probe not in source:
    raise SystemExit('v7_deferred_audit_probe_missing')

if replacement not in source:
    # The generator contains the same PurchaseIdentitySnapshot import in both
    # oldImports (the source-match anchor) and newImports (the generated runner).
    # Replace only the LAST occurrence so oldImports stays byte-for-byte intact.
    before, separator, after = source.rpartition(anchor)
    if not separator:
        raise SystemExit('v7_deferred_audit_new_import_occurrence_missing')
    source = before + replacement + after

v7.write_text(source)
print('v7_deferred_recovery_audit_compile_patch_applied')
