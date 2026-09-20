import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';
import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';

const SAMPLE_SIZE = 30;
const POOL_SIZE = 200;
const SEED = 'buyflow-maillens-real30-2026-09-20-v1';
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-sol'] as const;
const QUERY = process.env.EMAIL_DISCOVERY_QUERY?.trim()
  || 'category:purchases newer_than:60d -in:spam -in:trash';

const CORE_FIELDS = [
  'event_type',
  'shipment_phase',
  'order_number',
  'tracking_number',
  'payment_status',
  'invoice_number',
] as const;

type ModelName = typeof MODELS[number];
type CoreField = typeof CORE_FIELDS[number];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function evidenceContainsIdentifier(
  extraction: EmailExtraction,
  field: 'order_number' | 'tracking_number' | 'invoice_number',
  evidenceText: string,
): boolean {
  const value = extraction[field];
  if (!value) return true;
  const needle = normalizeIdentifier(value);
  if (needle.length < 3) return false;
  return normalizeIdentifier(evidenceText).includes(needle);
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b;
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedObject(map: Map<string, number>) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const page = await provider.searchMessages({ query: QUERY, limit: POOL_SIZE });
  const ranked = [...page.messages]
    .sort((a, b) => sha256(`${SEED}\n${a.providerMessageId}`).localeCompare(
      sha256(`${SEED}\n${b.providerMessageId}`),
    ));

  const selected: NormalizedEmail[] = [];
  const threads = new Set<string>();
  for (const listed of ranked) {
    const threadKey = listed.providerThreadId?.trim() || `message:${listed.providerMessageId}`;
    if (threads.has(threadKey)) continue;
    threads.add(threadKey);
    selected.push(listed);
    if (selected.length === SAMPLE_SIZE) break;
  }

  if (selected.length !== SAMPLE_SIZE) {
    throw new Error(`NOT_ENOUGH_CONTENT_BLIND_MESSAGES:${selected.length}`);
  }

  const sourceCounts = new Map<string, number>();
  const fieldAgreement = Object.fromEntries(CORE_FIELDS.map((field) => [field, 0])) as Record<CoreField, number>;
  const modelErrors: Record<ModelName, number> = { 'gpt-5.6-luna': 0, 'gpt-5.6-sol': 0 };
  const identifierEvidenceMisses: Record<ModelName, Record<string, number>> = {
    'gpt-5.6-luna': { order_number: 0, tracking_number: 0, invoice_number: 0 },
    'gpt-5.6-sol': { order_number: 0, tracking_number: 0, invoice_number: 0 },
  };
  const issueCounts: Record<ModelName, Map<string, number>> = {
    'gpt-5.6-luna': new Map(),
    'gpt-5.6-sol': new Map(),
  };
  const confidence: Record<ModelName, number[]> = {
    'gpt-5.6-luna': [],
    'gpt-5.6-sol': [],
  };
  const usage: Record<ModelName, { input: number; output: number; total: number; cached: number }> = {
    'gpt-5.6-luna': { input: 0, output: 0, total: 0, cached: 0 },
    'gpt-5.6-sol': { input: 0, output: 0, total: 0, cached: 0 },
  };

  let exactCoreAgreement = 0;
  let eventAndIdentityAgreement = 0;
  let snippetFallback = 0;
  let emptyAuthoredBody = 0;
  let semanticTruncated = 0;
  let bodyTruncated = 0;
  let fullBodyPreferredOverSnippet = 0;
  let applicationIssueGuardFailures = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let index = 0; index < selected.length; index += 1) {
    const listed = selected[index]!;
    const message = await provider.getMessage(listed.providerMessageId);

    const settled = await Promise.all(MODELS.map(async (model) => {
      try {
        const observation = await extractMailLensObservation({
          email: message,
          apiKey,
          model,
        });
        return { model, observation, error: null as string | null };
      } catch (error) {
        return {
          model,
          observation: null,
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        };
      }
    }));

    const byModel = Object.fromEntries(settled.map((item) => [item.model, item])) as Record<ModelName, typeof settled[number]>;
    const firstEvidence = settled.find((item) => item.observation)?.observation?.evidence;
    if (!firstEvidence) {
      for (const item of settled) if (item.error) modelErrors[item.model] += 1;
      rows.push({ case: index + 1, bothTechnicalFailure: true });
      continue;
    }

    const source = firstEvidence.normalization.bodyTextSource;
    bump(sourceCounts, source);
    if (source === 'snippet_fallback') snippetFallback += 1;
    if (!firstEvidence.bodyText.trim()) emptyAuthoredBody += 1;
    if (firstEvidence.normalization.semanticTextTruncated) semanticTruncated += 1;
    if (firstEvidence.normalization.bodyTextTruncated) bodyTruncated += 1;
    if ((message.snippet?.trim().length ?? 0) > 0
      && source !== 'snippet_fallback'
      && firstEvidence.bodyText.length > (message.snippet?.trim().length ?? 0)) {
      fullBodyPreferredOverSnippet += 1;
    }

    const privacySafeRow: Record<string, unknown> = {
      case: index + 1,
      bodySource: source,
      authoredChars: firstEvidence.bodyText.length,
      snippetChars: message.snippet?.trim().length ?? 0,
    };

    for (const item of settled) {
      if (item.error || !item.observation) {
        modelErrors[item.model] += 1;
        privacySafeRow[`${item.model}_error`] = true;
        continue;
      }

      const extraction = item.observation.result.extraction;
      confidence[item.model].push(extraction.confidence);
      usage[item.model].input += item.observation.result.inputTokens ?? 0;
      usage[item.model].output += item.observation.result.outputTokens ?? 0;
      usage[item.model].total += item.observation.result.totalTokens ?? 0;
      usage[item.model].cached += item.observation.result.cachedInputTokens ?? 0;
      for (const issue of extraction.evidence_issues ?? []) bump(issueCounts[item.model], issue);

      const evidenceText = [
        firstEvidence.subject ?? '',
        firstEvidence.from.join(' '),
        firstEvidence.bodyText,
      ].join('\n');

      for (const field of ['order_number', 'tracking_number', 'invoice_number'] as const) {
        if (!evidenceContainsIdentifier(extraction, field, evidenceText)) {
          identifierEvidenceMisses[item.model][field] += 1;
        }
      }

      const shouldHaveInsufficient = source === 'snippet_fallback' || !firstEvidence.bodyText.trim();
      const shouldHaveTruncated = firstEvidence.normalization.semanticTextTruncated;
      const issues = new Set(extraction.evidence_issues ?? []);
      if ((shouldHaveInsufficient && !issues.has('insufficient_evidence'))
        || (shouldHaveTruncated && !issues.has('truncated_input'))) {
        applicationIssueGuardFailures += 1;
      }

      privacySafeRow[`${item.model}_event`] = extraction.event_type;
      privacySafeRow[`${item.model}_phase`] = extraction.shipment_phase ?? null;
      privacySafeRow[`${item.model}_has_order`] = Boolean(extraction.order_number);
      privacySafeRow[`${item.model}_has_tracking`] = Boolean(extraction.tracking_number);
      privacySafeRow[`${item.model}_has_invoice`] = Boolean(extraction.invoice_number);
    }

    const luna = byModel['gpt-5.6-luna'].observation?.result.extraction;
    const sol = byModel['gpt-5.6-sol'].observation?.result.extraction;
    if (luna && sol) {
      let allCore = true;
      for (const field of CORE_FIELDS) {
        const equal = sameValue(luna[field], sol[field]);
        if (equal) fieldAgreement[field] += 1;
        else allCore = false;
      }
      if (allCore) exactCoreAgreement += 1;
      if (
        luna.event_type === sol.event_type
        && luna.order_number === sol.order_number
        && luna.tracking_number === sol.tracking_number
      ) {
        eventAndIdentityAgreement += 1;
      }
      privacySafeRow.coreExactAgreement = allCore;
    }

    rows.push(privacySafeRow);
  }

  const comparable = SAMPLE_SIZE - Math.max(modelErrors['gpt-5.6-luna'], modelErrors['gpt-5.6-sol']);
  const pct = (value: number, total: number) => total > 0
    ? Number(((value / total) * 100).toFixed(1))
    : 0;

  const summary = {
    benchmark: 'buyflow-maillens-real30-luna-sol-current-production-v1',
    createdAt: new Date().toISOString(),
    selection: {
      method: 'content-blind sha256(seed + providerMessageId), one message per thread',
      seed: SEED,
      selectionSha256: sha256(selected.map((item) => item.providerMessageId).join('\n')),
      query: QUERY,
      poolListed: page.messages.length,
      selected: selected.length,
    },
    safety: {
      databaseWrites: false,
      rawBodiesOutput: false,
      subjectsOutput: false,
      sendersOutput: false,
      identifierValuesOutput: false,
      providerMessageIdsOutput: false,
      openAIStore: false,
    },
    mailLens: {
      sourceCounts: sortedObject(sourceCounts),
      snippetFallback,
      emptyAuthoredBody,
      bodyTruncated,
      semanticTruncated,
      fullBodyPreferredOverSnippet,
      applicationIssueGuardFailures,
    },
    modelTechnicalErrors: modelErrors,
    comparison: {
      comparable,
      exactCoreAgreement: {
        count: exactCoreAgreement,
        pct: pct(exactCoreAgreement, comparable),
      },
      eventAndIdentityAgreement: {
        count: eventAndIdentityAgreement,
        pct: pct(eventAndIdentityAgreement, comparable),
      },
      fieldAgreement: Object.fromEntries(CORE_FIELDS.map((field) => [
        field,
        { count: fieldAgreement[field], pct: pct(fieldAgreement[field], comparable) },
      ])),
      note: 'Agreement is not ground-truth accuracy. This fresh set has no pre-frozen gold labels.',
    },
    identifierEvidenceMisses,
    evidenceIssueCounts: {
      'gpt-5.6-luna': sortedObject(issueCounts['gpt-5.6-luna']),
      'gpt-5.6-sol': sortedObject(issueCounts['gpt-5.6-sol']),
    },
    averageConfidence: {
      'gpt-5.6-luna': average(confidence['gpt-5.6-luna']),
      'gpt-5.6-sol': average(confidence['gpt-5.6-sol']),
    },
    usage,
    cases: rows,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('MAILLENS_REAL30_LUNA_SOL_FATAL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
