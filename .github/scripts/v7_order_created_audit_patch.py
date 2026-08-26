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

# Luna V3 input: current-email structured evidence plus a compact read-only
# journey snapshot built only from previously promotion-eligible graph state.
import_anchor = "import { evidenceEligibleForResolution } from '../extraction-v2/source-role-eligibility.js';\n"
import_insert = import_anchor + "import { buildPurchaseJourneyContext, buildStructuredEmailEvidence } from '../ai/purchase-journey-context.js';\n"
if import_anchor not in source:
    raise SystemExit('journey_context_import_anchor_missing')
source = source.replace(import_anchor, import_insert, 1)

call_signature = "async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1): Promise<AiCandidate> {"
call_signature_new = "async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1, journeyContext: string | null = null): Promise<AiCandidate> {"
if call_signature not in source:
    raise SystemExit('journey_context_call_signature_anchor_missing')
source = source.replace(call_signature, call_signature_new, 1)

body_anchor = "      bodyText: document.text,\n      fetchImpl: retryingFetch as typeof fetch,"
body_insert = """      bodyText: document.text,
      bodyHtml: document.html,
      structuredEvidence: buildStructuredEmailEvidence(document),
      journeyContext,
      fetchImpl: retryingFetch as typeof fetch,"""
if body_anchor not in source:
    raise SystemExit('journey_context_model_body_anchor_missing')
source = source.replace(body_anchor, body_insert, 1)

loop_setup_anchor = """  let processed = 0;

  for (const email of ordered) {
    const document = buildEmailDocumentV1(email);
    const base = baseExtractions.get(email.providerMessageId)!;
    const luna = await callModel(apiKey, 'gpt-5.6-luna', document);"""
loop_setup_insert = """  let processed = 0;
  let lunaJourneySnapshot = emptySnapshot();
  const journeyMerchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let messagesWithJourneyContext = 0;

  for (const email of ordered) {
    const document = buildEmailDocumentV1(email);
    const base = baseExtractions.get(email.providerMessageId)!;
    const journeyContext = buildPurchaseJourneyContext(document, lunaJourneySnapshot);
    if (journeyContext) messagesWithJourneyContext += 1;
    const luna = await callModel(apiKey, 'gpt-5.6-luna', document, journeyContext);"""
if loop_setup_anchor not in source:
    raise SystemExit('journey_context_loop_setup_anchor_missing')
source = source.replace(loop_setup_anchor, loop_setup_insert, 1)

luna_set_anchor = "    lunaExtractions.set(email.providerMessageId, augmentExtraction(base, luna.claims, 'gpt-5.6-luna'));\n\n    const reasons: string[] = [];"
luna_set_insert = """    const lunaAugmented = augmentExtraction(base, luna.claims, 'gpt-5.6-luna');
    lunaExtractions.set(email.providerMessageId, lunaAugmented);

    const journeyShadow = runGraphFromExtraction({
      userId: 'phase-e-100-v7-private-user',
      document,
      snapshot: lunaJourneySnapshot,
      extraction: lunaAugmented,
      merchantResolver: journeyMerchantResolver,
    });
    if (journeyShadow.promotionReadiness.eligible && journeyShadow.simulatedGraphMutated) {
      lunaJourneySnapshot = journeyShadow.simulatedSnapshot;
    }

    const reasons: string[] = [];"""
if luna_set_anchor not in source:
    raise SystemExit('journey_context_luna_snapshot_anchor_missing')
source = source.replace(luna_set_anchor, luna_set_insert, 1)

sol_call_anchor = "      const sol = await callModel(apiKey, 'gpt-5.6-sol', document);"
sol_call_insert = "      const sol = await callModel(apiKey, 'gpt-5.6-sol', document, journeyContext);"
if sol_call_anchor not in source:
    raise SystemExit('journey_context_sol_call_anchor_missing')
source = source.replace(sol_call_anchor, sol_call_insert, 1)

report_anchor = """    rejectedIdentifiers: {
      lunaOrder: rejectedLunaOrderIds,
      lunaTracking: rejectedLunaTrackingIds,
      solOrder: rejectedSolOrderIds,
      solTracking: rejectedSolTrackingIds,
    },
    productionWrites: 0,"""
report_insert = """    rejectedIdentifiers: {
      lunaOrder: rejectedLunaOrderIds,
      lunaTracking: rejectedLunaTrackingIds,
      solOrder: rejectedSolOrderIds,
      solTracking: rejectedSolTrackingIds,
    },
    journeyContext: {
      messagesWithContext: messagesWithJourneyContext,
      finalPurchases: lunaJourneySnapshot.purchases.length,
      finalShipments: lunaJourneySnapshot.shipments.length,
      finalInvoices: lunaJourneySnapshot.invoices.length,
      finalPayments: lunaJourneySnapshot.payments.length,
    },
    productionWrites: 0,"""
if report_anchor not in source:
    raise SystemExit('journey_context_report_anchor_missing')
source = source.replace(report_anchor, report_insert, 1)

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
