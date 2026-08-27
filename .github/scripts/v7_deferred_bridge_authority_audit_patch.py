from pathlib import Path
import sys

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
benchmark_patch_path = Path('.github/scripts/v7_deferred_recovery_benchmark_patch.py')
source = v7.read_text()
benchmark_patch = benchmark_patch_path.read_text()

required_contracts = [
    "exactBridgePromotionIneligible: number;",
    "probe.exactSameNamespacedKeySeenLater = true;",
    "exactBridgePromotionIneligible: false,",
]

if '--check' in sys.argv:
    for contract in required_contracts:
        if contract not in benchmark_patch:
            raise SystemExit('v7_deferred_bridge_authority_contract_missing')
    print('v7_deferred_bridge_authority_audit_patch_check_ok')
    raise SystemExit(0)

for contract in required_contracts:
    if contract not in source:
        raise SystemExit('v7_deferred_bridge_authority_source_anchor_missing')

# Add only aggregate/boolean categories. No raw identifiers, subjects, senders or
# message contents are emitted by this audit.
audit_type_anchor = "  exactBridgePromotionIneligible: number;\n  exactBridgeRecovered: number;"
audit_type_replacement = """  exactBridgePromotionIneligible: number;
  exactBridgeOrderIdentity: number;
  exactBridgeTrackingIdentity: number;
  exactBridgeInvoiceIdentity: number;
  exactBridgePaymentIdentity: number;
  exactBridgeSourceMerchant: number;
  exactBridgeSourceCarrier: number;
  exactBridgeSourceUnknown: number;
  exactBridgeSourceOther: number;
  exactBridgeAiOnlyIdentityEvidence: number;
  exactBridgeDeterministicOnlyIdentityEvidence: number;
  exactBridgeMixedIdentityEvidence: number;
  exactBridgeDecisionUnlinked: number;
  exactBridgeDecisionReview: number;
  exactBridgeDecisionPending: number;
  exactBridgeDecisionLinked: number;
  exactBridgeDecisionNewPurchase: number;
  exactBridgeNoHardConflict: number;
  exactBridgeHasHardConflict: number;
  exactBridgeRecovered: number;"""

probe_type_anchor = "  exactBridgePromotionIneligible: boolean;\n  exactBridgeRecovered: boolean;"
probe_type_replacement = """  exactBridgePromotionIneligible: boolean;
  exactBridgeOrderIdentity: boolean;
  exactBridgeTrackingIdentity: boolean;
  exactBridgeInvoiceIdentity: boolean;
  exactBridgePaymentIdentity: boolean;
  exactBridgeSourceMerchant: boolean;
  exactBridgeSourceCarrier: boolean;
  exactBridgeSourceUnknown: boolean;
  exactBridgeSourceOther: boolean;
  exactBridgeAiOnlyIdentityEvidence: boolean;
  exactBridgeDeterministicOnlyIdentityEvidence: boolean;
  exactBridgeMixedIdentityEvidence: boolean;
  exactBridgeDecisionUnlinked: boolean;
  exactBridgeDecisionReview: boolean;
  exactBridgeDecisionPending: boolean;
  exactBridgeDecisionLinked: boolean;
  exactBridgeDecisionNewPurchase: boolean;
  exactBridgeNoHardConflict: boolean;
  exactBridgeHasHardConflict: boolean;
  exactBridgeRecovered: boolean;"""

helper_anchor = "function summarizeRecoveryOpportunityAudit(probes: Map<string, RecoveryAuditProbe>): RecoveryOpportunityAudit {"
helper_code = r'''
function recoveryAuditFieldForKind(kind: RecoveryAuditIdentityKind): string {
  switch (kind) {
    case 'order': return 'order_number';
    case 'tracking': return 'tracking_number';
    case 'invoice': return 'invoice_number';
    case 'payment': return 'payment_reference';
  }
}

function recoveryAuditMatchingKinds(
  stored: RecoveryAuditIdentity[],
  current: RecoveryAuditIdentity[],
): Set<RecoveryAuditIdentityKind> {
  const kinds = new Set<RecoveryAuditIdentityKind>();
  for (const left of stored) {
    for (const right of current) {
      if (
        left.kind === right.kind
        && left.value === right.value
        && left.namespace
        && right.namespace
        && left.namespace === right.namespace
      ) {
        kinds.add(left.kind);
      }
    }
  }
  return kinds;
}

function recoveryAuditIdentityEvidenceSupport(
  event: CanonicalEvent,
  kinds: Set<RecoveryAuditIdentityKind>,
): { ai: boolean; nonAi: boolean } {
  const fields = new Set([...kinds].map(recoveryAuditFieldForKind));
  const provenance = event.provenance.filter((item) => fields.has(item.field));
  return {
    ai: provenance.some((item) => item.extractorId === 'openai-semantic-shadow'),
    nonAi: provenance.some((item) => item.extractorId !== 'openai-semantic-shadow'),
  };
}

'''

summary_anchor = "    exactBridgePromotionIneligible: count((probe) => probe.exactBridgePromotionIneligible),\n    exactBridgeRecovered: count((probe) => probe.exactBridgeRecovered),"
summary_replacement = """    exactBridgePromotionIneligible: count((probe) => probe.exactBridgePromotionIneligible),
    exactBridgeOrderIdentity: count((probe) => probe.exactBridgeOrderIdentity),
    exactBridgeTrackingIdentity: count((probe) => probe.exactBridgeTrackingIdentity),
    exactBridgeInvoiceIdentity: count((probe) => probe.exactBridgeInvoiceIdentity),
    exactBridgePaymentIdentity: count((probe) => probe.exactBridgePaymentIdentity),
    exactBridgeSourceMerchant: count((probe) => probe.exactBridgeSourceMerchant),
    exactBridgeSourceCarrier: count((probe) => probe.exactBridgeSourceCarrier),
    exactBridgeSourceUnknown: count((probe) => probe.exactBridgeSourceUnknown),
    exactBridgeSourceOther: count((probe) => probe.exactBridgeSourceOther),
    exactBridgeAiOnlyIdentityEvidence: count((probe) => probe.exactBridgeAiOnlyIdentityEvidence),
    exactBridgeDeterministicOnlyIdentityEvidence: count((probe) => probe.exactBridgeDeterministicOnlyIdentityEvidence),
    exactBridgeMixedIdentityEvidence: count((probe) => probe.exactBridgeMixedIdentityEvidence),
    exactBridgeDecisionUnlinked: count((probe) => probe.exactBridgeDecisionUnlinked),
    exactBridgeDecisionReview: count((probe) => probe.exactBridgeDecisionReview),
    exactBridgeDecisionPending: count((probe) => probe.exactBridgeDecisionPending),
    exactBridgeDecisionLinked: count((probe) => probe.exactBridgeDecisionLinked),
    exactBridgeDecisionNewPurchase: count((probe) => probe.exactBridgeDecisionNewPurchase),
    exactBridgeNoHardConflict: count((probe) => probe.exactBridgeNoHardConflict),
    exactBridgeHasHardConflict: count((probe) => probe.exactBridgeHasHardConflict),
    exactBridgeRecovered: count((probe) => probe.exactBridgeRecovered),"""

exact_anchor = "      probe.exactSameNamespacedKeySeenLater = true;\n      if (decision.kind === 'REVIEW' || decision.kind === 'PENDING') {"
exact_replacement = r'''      probe.exactSameNamespacedKeySeenLater = true;
      const matchingKinds = recoveryAuditMatchingKinds(probe.identities, currentIdentities);
      probe.exactBridgeOrderIdentity ||= matchingKinds.has('order');
      probe.exactBridgeTrackingIdentity ||= matchingKinds.has('tracking');
      probe.exactBridgeInvoiceIdentity ||= matchingKinds.has('invoice');
      probe.exactBridgePaymentIdentity ||= matchingKinds.has('payment');

      switch (canonicalEvent.sourceRole ?? 'unknown') {
        case 'merchant': probe.exactBridgeSourceMerchant = true; break;
        case 'carrier': probe.exactBridgeSourceCarrier = true; break;
        case 'unknown': probe.exactBridgeSourceUnknown = true; break;
        default: probe.exactBridgeSourceOther = true; break;
      }

      const identitySupport = recoveryAuditIdentityEvidenceSupport(canonicalEvent, matchingKinds);
      if (identitySupport.ai && identitySupport.nonAi) {
        probe.exactBridgeMixedIdentityEvidence = true;
      } else if (identitySupport.ai) {
        probe.exactBridgeAiOnlyIdentityEvidence = true;
      } else if (identitySupport.nonAi) {
        probe.exactBridgeDeterministicOnlyIdentityEvidence = true;
      }

      switch (decision.kind) {
        case 'UNLINKED': probe.exactBridgeDecisionUnlinked = true; break;
        case 'REVIEW': probe.exactBridgeDecisionReview = true; break;
        case 'PENDING': probe.exactBridgeDecisionPending = true; break;
        case 'LINKED': probe.exactBridgeDecisionLinked = true; break;
        case 'NEW_PURCHASE': probe.exactBridgeDecisionNewPurchase = true; break;
      }

      const hasHardConflict = (canonicalEvent.conflicts ?? []).some((item) => item.severity === 'hard');
      if (hasHardConflict) probe.exactBridgeHasHardConflict = true;
      else probe.exactBridgeNoHardConflict = true;

      if (decision.kind === 'REVIEW' || decision.kind === 'PENDING') {'''

init_anchor = "          exactBridgePromotionIneligible: false,\n          exactBridgeRecovered: false,"
init_replacement = """          exactBridgePromotionIneligible: false,
          exactBridgeOrderIdentity: false,
          exactBridgeTrackingIdentity: false,
          exactBridgeInvoiceIdentity: false,
          exactBridgePaymentIdentity: false,
          exactBridgeSourceMerchant: false,
          exactBridgeSourceCarrier: false,
          exactBridgeSourceUnknown: false,
          exactBridgeSourceOther: false,
          exactBridgeAiOnlyIdentityEvidence: false,
          exactBridgeDeterministicOnlyIdentityEvidence: false,
          exactBridgeMixedIdentityEvidence: false,
          exactBridgeDecisionUnlinked: false,
          exactBridgeDecisionReview: false,
          exactBridgeDecisionPending: false,
          exactBridgeDecisionLinked: false,
          exactBridgeDecisionNewPurchase: false,
          exactBridgeNoHardConflict: false,
          exactBridgeHasHardConflict: false,
          exactBridgeRecovered: false,"""

replacements = [
    (audit_type_anchor, audit_type_replacement, 'audit_type'),
    (probe_type_anchor, probe_type_replacement, 'probe_type'),
    (helper_anchor, helper_code + helper_anchor, 'helper'),
    (summary_anchor, summary_replacement, 'summary'),
    (exact_anchor, exact_replacement, 'exact_logic'),
    (init_anchor, init_replacement, 'init'),
]

for old, new, name in replacements:
    if old not in source:
        raise SystemExit(f'v7_deferred_bridge_authority_{name}_anchor_missing')
    source = source.replace(old, new, 1)

v7.write_text(source)
print('v7_deferred_bridge_authority_audit_patch_applied')
