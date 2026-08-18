import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';
import { detectProtocolEvidence } from '../protocols/detect.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import { evaluatePaymentShadow } from '../resolution/payment-shadow-evaluation.js';

const QUERIES = [
  'newer_than:730d -in:spam -in:trash from:noreply@barion.com subject:"Sikeres fizetés"',
  'newer_than:730d -in:spam -in:trash from:barion@barion.com subject:"Sikeres fizetés"',
];
const PAGE_SIZE = 200;
const BARION_PROTOCOL_ID = 'payment.hu.barion';

async function main(): Promise<void> {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });
  const profiles = registeredTestProtocolProfiles().filter(
    (profile) => profile.protocol_id === BARION_PROTOCOL_ID,
  );
  if (profiles.length !== 1) throw new Error('barion_profile_count');

  const seen = new Set<string>();
  let listedMessages = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let detectorPass = 0;
  let normalizedPass = 0;
  let productionEligibleRows = 0;
  let anyWouldWrite = 0;
  let unmatched = 0;
  let nonUnmatched = 0;

  for (const query of QUERIES) {
    let cursor: string | undefined;
    do {
      const page = await provider.searchMessages({
        query,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });

      for (const listed of page.messages) {
        listedMessages += 1;
        if (seen.has(listed.providerMessageId)) continue;
        seen.add(listed.providerMessageId);
        fullMessageFetches += 1;

        let full;
        try {
          full = await provider.getMessage(listed.providerMessageId);
        } catch {
          fullMessageFetchFailures += 1;
          continue;
        }

        const input = protocolDetectionInputFromEmail(full);
        const evidence = detectProtocolEvidence(input, profiles).filter(
          (row) => row.protocol_id === BARION_PROTOCOL_ID && row.event_candidate === 'PAYMENT_SUCCESS',
        );
        productionEligibleRows += evidence.filter((row) => row.production_eligible).length;
        if (evidence.length !== 1) continue;
        detectorPass += 1;

        const evaluation = evaluatePaymentShadow({
          sourceEmailId: listed.providerMessageId,
          userId: 'read-only-barion-audit',
          provider: 'barion',
          providerAuthenticated: true,
          subject: input.subject ?? '',
          body: input.bodyText ?? '',
          receivedAt: listed.receivedAt,
        }, []);
        if (!evaluation) continue;
        normalizedPass += 1;
        if (evaluation.wouldWrite || evaluation.resolution.wouldWrite) anyWouldWrite += 1;
        if (evaluation.resolution.decision === 'unmatched') unmatched += 1;
        else nonUnmatched += 1;
      }

      cursor = page.nextCursor;
    } while (cursor);
  }

  if (productionEligibleRows !== 0) throw new Error('production_eligible_barion_evidence');
  if (anyWouldWrite !== 0) throw new Error('write_authority_detected');

  console.log(JSON.stringify({
    mode: 'read_only_barion_full_audit_v1',
    safety: {
      databaseWrites: false,
      mailboxWrites: false,
      purchaseWrites: false,
      paymentWrites: false,
      productionEligibleRows,
      anyWouldWrite,
      rawBodyOutput: false,
      rawSubjectOutput: false,
      messageIdOutput: false,
      senderOutput: false,
      paymentReferenceOutput: false,
      merchantOutput: false,
      amountOutput: false,
    },
    counts: {
      listedMessages,
      uniqueMessages: seen.size,
      fullMessageFetches,
      fullMessageFetchFailures,
      detectorPass,
      normalizedPass,
      unmatched,
      nonUnmatched,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    mode: 'read_only_barion_full_audit_v1',
    status: 'failed',
    errorKind: error instanceof Error ? error.name : 'UnknownError',
    rawErrorOutput: false,
  }));
  process.exit(1);
});
