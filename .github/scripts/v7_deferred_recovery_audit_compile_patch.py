from pathlib import Path
import sys

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
benchmark_patch_path = Path('.github/scripts/v7_deferred_recovery_benchmark_patch.py')
source = v7.read_text()
benchmark_patch = benchmark_patch_path.read_text()

deferred_anchor = "import { exactIdentityKeys, type UnresolvedEventPoolSnapshot } from '../purchase-identity-v2/unresolved-event-pool.js';\n"
canonical_import = "import type { CanonicalEvent } from '../purchase-identity-v2/types.js';\n"
probe = "function recoveryAuditIdentities(event: CanonicalEvent): RecoveryAuditIdentity[]"

if '--check' in sys.argv:
    # The repository source is intentionally unpatched at this stage. Validate
    # the patch contract itself instead of guessing how many matching imports
    # exist inside the V7 generator's oldImports/newImports template strings.
    if deferred_anchor not in benchmark_patch:
        raise SystemExit('v7_deferred_audit_deferred_import_contract_missing')
    if probe not in benchmark_patch:
        raise SystemExit('v7_deferred_audit_probe_contract_missing')
    print('v7_deferred_recovery_audit_compile_patch_check_ok')
    raise SystemExit(0)

# This script runs only after v7_deferred_recovery_benchmark_patch.py. Anchor the
# CanonicalEvent type import to the unique deferred import that patch just added,
# rather than touching the generator's oldImports source-match template.
if probe not in source:
    raise SystemExit('v7_deferred_audit_probe_missing')
if deferred_anchor not in source:
    raise SystemExit('v7_deferred_audit_deferred_import_missing')
if canonical_import not in source:
    source = source.replace(deferred_anchor, deferred_anchor + canonical_import, 1)

v7.write_text(source)
print('v7_deferred_recovery_audit_compile_patch_applied')
