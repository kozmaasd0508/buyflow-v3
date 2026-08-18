import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';

const QUERIES = [
  'newer_than:730d -in:spam -in:trash from:noreply@barion.com subject:"Sikeres fizetés"',
  'newer_than:730d -in:spam -in:trash from:barion@barion.com subject:"Sikeres fizetés"',
];

const SUCCESS_BODY_PATTERN = /Sikeresen\s+fizett[eé]l\s+[0-9][0-9 .\u00a0]*\s*Ft-ot\s+bankk[aá]rty[aá]val/i;
const SUCCESS_LEAD_PATTERN = /Sikeresen\s+fizett[eé]l/i;
const AMOUNT_FT_PATTERN = /[0-9][0-9 .\u00a0]*\s*Ft/i;
const FT_OT_ASCII_PATTERN = /Ft-ot/i;
const FT_OT_DASH_FLEX_PATTERN = /Ft[\s\p{Pd}-]*ot/iu;
const BANKCARD_PATTERN = /bankk[aá]rty[aá]val/i;
const PAYMENT_ID_PATTERN = /Fizet[eé]s Barion azonos[ií]t[oó]ja\s*:\s*[0-9a-f]{32}/i;

async function main(): Promise<void> {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const counters = {
    samplesRequested: QUERIES.length,
    samplesFound: 0,
    fullMessageFetchFailures: 0,
    snippetSuccessBodyPass: 0,
    bodyTextPresent: 0,
    bodySuccessBodyPass: 0,
    bodySuccessLeadPass: 0,
    bodyAmountFtPass: 0,
    bodyFtOtAsciiPass: 0,
    bodyFtOtDashFlexiblePass: 0,
    bodyBankcardPass: 0,
    bodyPaymentIdPass: 0,
    bodySemanticTokenSetPass: 0,
  };

  for (const query of QUERIES) {
    const page = await provider.searchMessages({ query, limit: 1 });
    const listed = page.messages[0];
    if (!listed) continue;
    counters.samplesFound += 1;

    let full;
    try {
      full = await provider.getMessage(listed.providerMessageId);
    } catch {
      counters.fullMessageFetchFailures += 1;
      continue;
    }

    const input = protocolDetectionInputFromEmail(full);
    const snippet = full.snippet ?? listed.snippet ?? '';
    const body = input.bodyText ?? '';
    const successLead = SUCCESS_LEAD_PATTERN.test(body);
    const amountFt = AMOUNT_FT_PATTERN.test(body);
    const ftOtDashFlexible = FT_OT_DASH_FLEX_PATTERN.test(body);
    const bankcard = BANKCARD_PATTERN.test(body);

    if (SUCCESS_BODY_PATTERN.test(snippet)) counters.snippetSuccessBodyPass += 1;
    if (body.trim()) counters.bodyTextPresent += 1;
    if (SUCCESS_BODY_PATTERN.test(body)) counters.bodySuccessBodyPass += 1;
    if (successLead) counters.bodySuccessLeadPass += 1;
    if (amountFt) counters.bodyAmountFtPass += 1;
    if (FT_OT_ASCII_PATTERN.test(body)) counters.bodyFtOtAsciiPass += 1;
    if (ftOtDashFlexible) counters.bodyFtOtDashFlexiblePass += 1;
    if (bankcard) counters.bodyBankcardPass += 1;
    if (PAYMENT_ID_PATTERN.test(body)) counters.bodyPaymentIdPass += 1;
    if (successLead && amountFt && ftOtDashFlexible && bankcard) {
      counters.bodySemanticTokenSetPass += 1;
    }
  }

  console.log(JSON.stringify({
    mode: 'read_only_barion_fast_diagnostic_v1',
    safety: {
      databaseWrites: false,
      mailboxWrites: false,
      rawBodyOutput: false,
      rawSnippetOutput: false,
      rawSubjectOutput: false,
      messageIdOutput: false,
      senderOutput: false,
      paymentReferenceOutput: false,
      amountOutput: false,
    },
    counters,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    mode: 'read_only_barion_fast_diagnostic_v1',
    status: 'failed',
    errorKind: error instanceof Error ? error.name : 'UnknownError',
  }));
  process.exit(1);
});
