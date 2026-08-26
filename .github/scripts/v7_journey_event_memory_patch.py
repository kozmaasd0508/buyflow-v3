from pathlib import Path

v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')
source = v7.read_text()

replacements = [
    (
        "import { buildPurchaseJourneyContext, buildStructuredEmailEvidence } from '../ai/purchase-journey-context.js';\n",
        "import { buildPurchaseJourneyContext, buildStructuredEmailEvidence, type PurchaseJourneyMemoryEvent } from '../ai/purchase-journey-context.js';\n",
    ),
    (
        """  const journeyMerchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let messagesWithJourneyContext = 0;

  for (const email of ordered) {""",
        """  const journeyMerchantResolver = buildTestProtocolMerchantIdentityRegistry();
  const journeyEventMemory: PurchaseJourneyMemoryEvent[] = [];
  let messagesWithJourneyContext = 0;

  for (const email of ordered) {""",
    ),
    (
        "    const journeyContext = buildPurchaseJourneyContext(document, lunaJourneySnapshot);",
        "    const journeyContext = buildPurchaseJourneyContext(document, lunaJourneySnapshot, 5, journeyEventMemory);",
    ),
    (
        """    const journeyShadow = runGraphFromExtraction({
      userId: 'phase-e-100-v7-private-user',
      document,
      snapshot: lunaJourneySnapshot,
      extraction: lunaAugmented,
      merchantResolver: journeyMerchantResolver,
    });
    if (journeyShadow.promotionReadiness.eligible && journeyShadow.simulatedGraphMutated) {
      lunaJourneySnapshot = journeyShadow.simulatedSnapshot;
    }
""",
        """    const journeyBeforeSnapshot = lunaJourneySnapshot;
    const journeyShadow = runGraphFromExtraction({
      userId: 'phase-e-100-v7-private-user',
      document,
      snapshot: lunaJourneySnapshot,
      extraction: lunaAugmented,
      merchantResolver: journeyMerchantResolver,
    });
    if (journeyShadow.promotionReadiness.eligible && journeyShadow.simulatedGraphMutated) {
      let memoryPurchaseId: string | null = null;
      if (journeyShadow.promotionReadiness.action === 'CREATE_PURCHASE') {
        const beforePurchaseIds = new Set(journeyBeforeSnapshot.purchases.map((purchase) => purchase.purchaseId));
        memoryPurchaseId = journeyShadow.simulatedSnapshot.purchases.find(
          (purchase) => !beforePurchaseIds.has(purchase.purchaseId),
        )?.purchaseId ?? null;
      } else if (
        journeyShadow.promotionReadiness.action === 'LINK_EVENT'
        && journeyShadow.decision?.kind === 'LINKED'
      ) {
        memoryPurchaseId = journeyShadow.decision.purchaseId;
      }

      lunaJourneySnapshot = journeyShadow.simulatedSnapshot;
      const event = journeyShadow.canonicalEvent;
      if (event && memoryPurchaseId) {
        journeyEventMemory.push({
          purchaseId: memoryPurchaseId,
          eventType: event.eventType,
          receivedAt: event.receivedAt,
          sourceRole: event.sourceRole ?? null,
          merchantNamespace: event.merchantNamespace ?? null,
          orderId: event.orderIdNormalized ?? event.orderIdRaw,
          trackingId: event.trackingIdNormalized ?? event.trackingIdRaw,
          carrierId: event.carrierId ?? null,
          invoiceId: event.invoiceIdNormalized ?? event.invoiceIdRaw,
          paymentReference: event.paymentReference,
          amount: event.amount,
          currency: event.currency,
        });
      }
    }
""",
    ),
    (
        """    journeyContext: {
      messagesWithContext: messagesWithJourneyContext,
      finalPurchases: lunaJourneySnapshot.purchases.length,
      finalShipments: lunaJourneySnapshot.shipments.length,
      finalInvoices: lunaJourneySnapshot.invoices.length,
      finalPayments: lunaJourneySnapshot.payments.length,
    },""",
        """    journeyContext: {
      messagesWithContext: messagesWithJourneyContext,
      trustedEvents: journeyEventMemory.length,
      trustedEventTypes: journeyEventMemory.reduce((counts, event) => {
        counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
        return counts;
      }, {} as Record<string, number>),
      finalPurchases: lunaJourneySnapshot.purchases.length,
      finalShipments: lunaJourneySnapshot.shipments.length,
      finalInvoices: lunaJourneySnapshot.invoices.length,
      finalPayments: lunaJourneySnapshot.payments.length,
    },""",
    ),
]

for old, new in replacements:
    if old not in source:
        raise SystemExit('journey_event_memory_patch_anchor_missing')
    source = source.replace(old, new, 1)

v7.write_text(source)
