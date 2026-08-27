from pathlib import Path
import sys

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
deferred_patch_path = Path('.github/scripts/v7_deferred_recovery_benchmark_patch.py')
source = v7.read_text()
deferred_patch = deferred_patch_path.read_text()

import_anchor = "import { exactIdentityKeys, type UnresolvedEventPoolSnapshot } from '../purchase-identity-v2/unresolved-event-pool.js';\n"
import_addition = (
    "import { EvidenceIdentityGraph } from '../purchase-identity-v2/evidence-identity-graph.js';\n"
    "import { VerifiedIdentityObservationStore } from '../purchase-identity-v2/verified-identity-observation.js';\n"
)

type_anchor = "  recoveryOpportunityAudit: RecoveryOpportunityAudit;\n};"
type_replacement = """  recoveryOpportunityAudit: RecoveryOpportunityAudit;
  verifiedIdentityObservations: number;
  evidenceUniqueOwnerCandidates: number;
  evidenceAmbiguousCandidates: number;
  evidenceWaitingCandidates: number;
  evidenceUnverifiedCandidates: number;
  evidenceWrongOwnerCandidates: number;
};"""

store_anchor = "  const recoveryAuditProbes = new Map<string, RecoveryAuditProbe>();\n"
store_replacement = store_anchor + "  const verifiedObservationStore = new VerifiedIdentityObservationStore();\n"

observe_anchor = "    canonicalEvent.purchaseCreationReasons = creationAuthority.reasons;\n\n    const currentIdentities = recoveryAuditIdentities(canonicalEvent);"
observe_replacement = """    canonicalEvent.purchaseCreationReasons = creationAuthority.reasons;

    // VERIFIED evidence is remembered independently from Purchase mutation.
    // This does not grant CREATE/LINK authority and rejects AI-only identity proof.
    verifiedObservationStore.observe(canonicalEvent);

    const currentIdentities = recoveryAuditIdentities(canonicalEvent);"""

return_anchor = "  return {\n    lane: input.lane,\n    journeys: input.journeys.length,"
return_prefix = r'''  const finalEvidenceGraph = new EvidenceIdentityGraph(snapshot, verifiedObservationStore.snapshot());
  let evidenceUniqueOwnerCandidates = 0;
  let evidenceAmbiguousCandidates = 0;
  let evidenceWaitingCandidates = 0;
  let evidenceUnverifiedCandidates = 0;
  let evidenceWrongOwnerCandidates = 0;

  for (const record of unresolvedSnapshot.records) {
    if (record.status !== 'unresolved') continue;
    const resolution = finalEvidenceGraph.resolveEvent(record.event);
    if (resolution.kind === 'UNIQUE_OWNER') {
      evidenceUniqueOwnerCandidates += 1;
      const owner = purchaseOwner.get(resolution.purchaseId);
      const eventOwners = input.messageOwners.get(record.event.sourceMessageId) ?? new Set<string>();
      if (!owner || !eventOwners.has(owner)) evidenceWrongOwnerCandidates += 1;
    } else if (resolution.kind === 'AMBIGUOUS') {
      evidenceAmbiguousCandidates += 1;
    } else if (resolution.kind === 'WAITING') {
      evidenceWaitingCandidates += 1;
    } else {
      evidenceUnverifiedCandidates += 1;
    }
  }

'''

return_fields_anchor = """    unresolvedRemaining: unresolvedSnapshot.records.filter((record) => record.status === 'unresolved').length,
    recoveryOpportunityAudit: summarizeRecoveryOpportunityAudit(recoveryAuditProbes),
    unsafeCount,"""
return_fields_replacement = """    unresolvedRemaining: unresolvedSnapshot.records.filter((record) => record.status === 'unresolved').length,
    recoveryOpportunityAudit: summarizeRecoveryOpportunityAudit(recoveryAuditProbes),
    verifiedIdentityObservations: verifiedObservationStore.snapshot().observations.length,
    evidenceUniqueOwnerCandidates,
    evidenceAmbiguousCandidates,
    evidenceWaitingCandidates,
    evidenceUnverifiedCandidates,
    evidenceWrongOwnerCandidates,
    unsafeCount,"""

if '--check' in sys.argv:
    # This patch runs after v7_deferred_recovery_benchmark_patch.py. Its normal
    # anchors therefore do not exist in the committed V7 source yet. Validate
    # the upstream patch contract instead of requiring generated runtime source.
    required_contracts = [
        "exactIdentityKeys, type UnresolvedEventPoolSnapshot",
        "recoveryOpportunityAudit: RecoveryOpportunityAudit;",
        "const recoveryAuditProbes = new Map<string, RecoveryAuditProbe>();",
        "canonicalEvent.purchaseCreationReasons = creationAuthority.reasons;",
        "recoveryOpportunityAudit: summarizeRecoveryOpportunityAudit(recoveryAuditProbes)",
    ]
    for contract in required_contracts:
        if contract not in deferred_patch:
            raise SystemExit('v7_evidence_identity_graph_upstream_contract_missing')
    print('v7_evidence_identity_graph_benchmark_patch_check_ok')
    raise SystemExit(0)

checks = [
    (import_anchor, 'import'),
    (type_anchor, 'type'),
    (store_anchor, 'store'),
    (observe_anchor, 'observe'),
    (return_anchor, 'return'),
    (return_fields_anchor, 'return_fields'),
]

for anchor, name in checks:
    if anchor not in source:
        raise SystemExit(f'v7_evidence_identity_graph_{name}_anchor_missing')

source = source.replace(import_anchor, import_anchor + import_addition, 1)
source = source.replace(type_anchor, type_replacement, 1)
source = source.replace(store_anchor, store_replacement, 1)
source = source.replace(observe_anchor, observe_replacement, 1)
source = source.replace(return_anchor, return_prefix + return_anchor, 1)
source = source.replace(return_fields_anchor, return_fields_replacement, 1)

v7.write_text(source)
print('v7_evidence_identity_graph_benchmark_patch_applied')
