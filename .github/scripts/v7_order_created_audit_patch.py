from pathlib import Path

v5 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v5-scoped.ts')
source = v5.read_text()
old = """  const ordered = [...allMessages.values()].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt) || a.providerMessageId.localeCompare(b.providerMessageId));"""
new = """  const ordered = [...allMessages.values()].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt) || a.providerMessageId.localeCompare(b.providerMessageId)).slice(0, 100);"""
if old not in source:
    raise SystemExit('ordered_100_patch_anchor_missing')
v5.write_text(source.replace(old, new, 1))

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
source = v7.read_text()
replacements = {
    "    const reasons = needsSol(base, luna);": "    const reasons: string[] = [];",
    "    || baseline.discoveredMessages !== 340": "    || baseline.discoveredMessages !== 100",
    "    || baseline.automaticCreates !== 26": "    || baseline.automaticCreates < 0",
    "    || baseline.automaticLinks !== 13": "    || baseline.automaticLinks < 0",
}
for old, new in replacements.items():
    if old not in source:
        raise SystemExit('v7_patch_anchor_missing:' + old)
    source = source.replace(old, new, 1)

setup_anchor = "  let unsafeCount = 0;\n"
setup_insert = """  let unsafeCount = 0;
  const orderCreatedAuditLimit = input.lane === 'luna'
    ? Math.max(0, Math.min(100, Number(process.env.V7_ORDER_CREATED_AUDIT_LIMIT ?? '0') || 0))
    : 0;
  const blockedOrderCreatedAudit: unknown[] = [];
"""
if setup_anchor not in source:
    raise SystemExit('order_created_audit_setup_anchor_missing')
source = source.replace(setup_anchor, setup_insert, 1)

collect_anchor = "    for (const reason of shadow.promotionReadiness.reasons) inc(promotionReasonCounts, reason);\n"
collect_insert = """    for (const reason of shadow.promotionReadiness.reasons) inc(promotionReasonCounts, reason);

    if (
      shadow.canonicalEvent?.eventType === 'order_created'
      && !(eligible && action === 'CREATE_PURCHASE')
      && blockedOrderCreatedAudit.length < orderCreatedAuditLimit
    ) {
      const event = shadow.canonicalEvent;
      const claims = extraction.evidence.bundle.claims;
      const claimFields = [...new Set(claims.map((claim) => claim.field))].sort();
      const aiClaimFields = [...new Set(claims
        .filter((claim) => claim.extractorId === 'openai-semantic-shadow')
        .map((claim) => claim.field))].sort();
      const deterministicClaimFields = [...new Set(claims
        .filter((claim) => claim.extractorId !== 'openai-semantic-shadow')
        .map((claim) => claim.field))].sort();
      blockedOrderCreatedAudit.push({
        caseId: opaque('v7-blocked-order-created-audit', email.providerMessageId),
        ownerCount: owners.size,
        decisionKind: decision?.kind ?? null,
        promotionEligible: eligible,
        promotionAction: action,
        promotionReasons: [...shadow.promotionReadiness.reasons].sort(),
        sourceRole: event.sourceRole ?? null,
        purchaseCreationAuthority: event.purchaseCreationAuthority ?? null,
        purchaseCreationReasons: [...(event.purchaseCreationReasons ?? [])].sort(),
        explicitNonAcceptance: explicitNonAcceptance(document),
        hasOrderId: Boolean(event.orderIdNormalized),
        hasTrackingId: Boolean(event.trackingIdNormalized),
        hasInvoiceId: Boolean(event.invoiceIdNormalized),
        hasPaymentReference: Boolean(event.paymentReference),
        hasMerchantId: Boolean(event.merchantId),
        hasMerchantNamespace: Boolean(event.merchantNamespace),
        hasAmountCurrency: Boolean(event.amount != null && event.currency),
        productFingerprintCount: event.productFingerprints.length,
        conflictFields: (event.conflicts ?? []).map((conflict) => ({
          field: conflict.field,
          severity: conflict.severity,
        })).sort((a, b) => a.field.localeCompare(b.field)),
        decisionEvidenceTypes: decision && 'reasons' in decision
          ? [...new Set(decision.reasons.map((reason) => reason.evidenceType))].sort()
          : [],
        claimFields,
        aiClaimFields,
        deterministicClaimFields,
        eventTypeClaimExtractorIds: [...new Set(claims
          .filter((claim) => claim.field === 'event_type')
          .map((claim) => claim.extractorId ?? 'unknown'))].sort(),
        orderNumberClaimExtractorIds: [...new Set(claims
          .filter((claim) => claim.field === 'order_number')
          .map((claim) => claim.extractorId ?? 'unknown'))].sort(),
        structuralSignalCounts: {
          orderNumbers: document.signals.orderNumbers.length,
          trackingNumbers: document.signals.trackingNumbers.length,
          couriers: document.signals.couriers.length,
          amounts: document.signals.amounts.length,
          products: document.signals.products.length,
        },
        snapshotMatchCounts: {
          orderExact: event.orderIdNormalized
            ? before.orders.filter((order) => order.orderId === event.orderIdNormalized).length : 0,
          trackingExact: event.trackingIdNormalized
            ? before.shipments.filter((shipment) => shipment.trackingId === event.trackingIdNormalized).length : 0,
          invoiceExact: event.invoiceIdNormalized
            ? before.invoices.filter((invoice) => invoice.invoiceId === event.invoiceIdNormalized).length : 0,
          paymentReferenceExact: event.paymentReference
            ? before.payments.filter((payment) => payment.paymentReference === event.paymentReference).length : 0,
          merchantId: event.merchantId
            ? before.purchases.filter((purchase) => purchase.canonicalMerchantId === event.merchantId).length : 0,
          merchantNamespace: event.merchantNamespace
            ? before.orders.filter((order) => order.merchantNamespace === event.merchantNamespace).length : 0,
        },
      });
    }
"""
if collect_anchor not in source:
    raise SystemExit('order_created_audit_collect_anchor_missing')
source = source.replace(collect_anchor, collect_insert, 1)

return_anchor = """  return {
    lane: input.lane,
"""
return_insert = """  if (input.lane === 'luna' && orderCreatedAuditLimit > 0) {
    console.log('PHASE_E_100_V7_BLOCKED_ORDER_CREATED_AUDIT ' + JSON.stringify({
      sampleLimit: orderCreatedAuditLimit,
      sampled: blockedOrderCreatedAudit.length,
      cases: blockedOrderCreatedAudit,
    }));
  }

  return {
    lane: input.lane,
"""
if return_anchor not in source:
    raise SystemExit('order_created_audit_return_anchor_missing')
source = source.replace(return_anchor, return_insert, 1)
v7.write_text(source)
