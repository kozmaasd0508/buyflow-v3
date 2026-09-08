import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeaderLike[];
  body?: GmailBodyLike;
  parts?: GmailPartLike[];
}
interface GmailMessageLike {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPartLike;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_NORMALIZER = 'normalized-email-document-v1.1';

function headerValue(part: GmailPartLike | undefined, name: string): string | null {
  const expected = name.toLowerCase();
  const found = (part?.headers ?? []).find((h) => h.name?.toLowerCase() === expected);
  return found?.value?.trim() || null;
}

function isDetachedRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  const disposition = headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '';
  if (/\battachment\b/.test(disposition)) return false;
  return Boolean(part.body?.attachmentId?.trim() && !part.body?.data);
}

async function gmailJson(urlPath: string, token: string): Promise<any> {
  const retryMs = [500, 1500, 4000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${GMAIL_BASE}${urlPath}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (response.ok) return await response.json();
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retryMs.length) {
      await new Promise((resolve) => setTimeout(resolve, retryMs[attempt]!));
      continue;
    }
    throw new Error(`GMAIL_HTTP_${response.status}`);
  }
}

async function hydrateDetachedBodies(part: GmailPartLike | undefined, messageId: string, token: string): Promise<number> {
  if (!part) return 0;
  let hydrated = 0;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, token);
    if (typeof payload.data !== 'string' || payload.data.length === 0) throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');
    part.body = { ...part.body, data: payload.data, ...(typeof payload.size === 'number' ? { size: payload.size } : {}) };
    hydrated += 1;
  }
  for (const child of part.parts ?? []) hydrated += await hydrateDetachedBodies(child, messageId, token);
  return hydrated;
}

async function main() {
  const idsPath = process.argv[2];
  const oldBundlePath = process.argv[3];
  const outDirArg = process.argv[4];
  if (!idsPath || !oldBundlePath || !outDirArg) throw new Error('USAGE: <h1-ids.json> <old-bundle.json> <output-dir>');
  const token = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const idsDoc = JSON.parse(await readFile(idsPath, 'utf8')) as any;
  const ids: string[] = Array.isArray(idsDoc) ? idsDoc : idsDoc?.ids;
  if (!Array.isArray(ids) || ids.length !== 60 || ids.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new Error('H1_IDS_INVALID');
  }
  const oldBundle = JSON.parse(await readFile(oldBundlePath, 'utf8')) as any;
  if (!Array.isArray(oldBundle?.cases) || oldBundle.cases.length !== 60) throw new Error('OLD_H1_BUNDLE_INVALID');

  const outDir = path.resolve(outDirArg);
  const oldByCase = new Map<string, any>(oldBundle.cases.map((c: any) => [c.case_id, c]));
  const rebuiltCases: any[] = [];
  const sourceCounts: Record<string, number> = {};
  let semanticLongerThanOld = 0;
  let semanticEqualOld = 0;
  let semanticEqualsSnippet = 0;
  let totalHydrated = 0;

  console.log('==============================================================');
  console.log('BUYFLOW H1 MAILLENS REBUILD AUDIT');
  console.log(`Expected normalizer: ${EXPECTED_NORMALIZER}`);
  console.log('Same 60 H1 IDs. Gmail GET only. No OpenAI calls.');
  console.log('BuyFlow writes 0. Production OFF. O3 NOT USED.');
  console.log('==============================================================');

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!.trim();
    const caseId = `H1-${String(i + 1).padStart(3, '0')}`;
    const message = await gmailJson(`/messages/${encodeURIComponent(id)}?format=full`, token) as GmailMessageLike;
    if (message.id !== id) throw new Error(`GMAIL_ID_MISMATCH:${caseId}`);
    const hydrated = await hydrateDetachedBodies(message.payload, id, token);
    totalHydrated += hydrated;
    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    if (document.normalizerVersion !== EXPECTED_NORMALIZER) {
      throw new Error(`STALE_MAILLENS_NORMALIZER:${document.normalizerVersion}`);
    }

    const semanticText = document.semanticText?.trim() || document.snippet?.trim() || '';
    const snippet = document.snippet?.trim() || '';
    const old = oldByCase.get(caseId);
    const oldSemantic = typeof old?.semantic_text === 'string' ? old.semantic_text : '';
    const source = document.normalization.bodyTextSource;
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    if (semanticText.length > oldSemantic.length) semanticLongerThanOld += 1;
    if (semanticText === oldSemantic) semanticEqualOld += 1;
    if (semanticText && snippet && semanticText === snippet) semanticEqualsSnippet += 1;

    rebuiltCases.push({
      case_id: caseId,
      from: headerValue(message.payload, 'From') ?? '',
      subject: headerValue(message.payload, 'Subject') ?? '',
      semantic_text: semanticText,
      mail_lens_normalizer: document.normalizerVersion,
      body_text_source: source,
      body_text_chars: document.bodyText?.length ?? 0,
      semantic_text_chars: semanticText.length,
      snippet_chars: snippet.length,
      semantic_equals_snippet: Boolean(semanticText && snippet && semanticText === snippet),
      old_semantic_chars: oldSemantic.length,
      old_equals_new: semanticText === oldSemantic,
      body_text_truncated: document.normalization.bodyTextTruncated,
      semantic_text_truncated: document.normalization.semanticTextTruncated,
      quoted_history_detected: document.normalization.quotedHistoryDetected,
      hidden_html_removed: document.normalization.hiddenHtmlRemoved,
      detached_bodies_hydrated: hydrated,
    });
    console.log(`[${String(i + 1).padStart(2, '0')}/60] ${caseId} source=${source} old=${oldSemantic.length} new=${semanticText.length}`);
  }

  const oldVersions = [...new Set(oldBundle.cases.map((c: any) => String(c.mail_lens_normalizer ?? 'unknown')))];
  const rebuilt = {
    benchmark: 'buyflow-real60-h1-blind-maillens-v1.1-rebuild',
    created_at: new Date().toISOString(),
    total_cases: 60,
    selection_sha256: idsDoc?.selection_sha256 ?? oldBundle?.selection_sha256 ?? null,
    source: 'MailLens subject + sender + semanticText',
    model_predictions_included: false,
    corrected_input_diagnostic_only: true,
    prior_h1_model_results_not_reused_as_clean_holdout: true,
    mail_lens_pinned_normalizer: EXPECTED_NORMALIZER,
    privacy: {
      contains_private_email_text: true,
      raw_gmail_ids_included: false,
      model_outputs_included: false,
      gmail_http_methods: ['GET'],
      buyflow_writes: 0,
      production_off: true,
      blind_o3_used: false,
    },
    cases: rebuiltCases.map(({ old_semantic_chars, old_equals_new, ...c }) => c),
  };
  const audit = {
    benchmark: 'buyflow-real60-h1-maillens-audit-v2',
    created_at: new Date().toISOString(),
    count: 60,
    old_bundle_normalizer_versions: oldVersions,
    expected_normalizer: EXPECTED_NORMALIZER,
    source_counts: sourceCounts,
    semantic_longer_than_old_count: semanticLongerThanOld,
    semantic_equal_old_count: semanticEqualOld,
    semantic_equals_gmail_snippet_count: semanticEqualsSnippet,
    hydrated_detached_bodies: totalHydrated,
    rows: rebuiltCases.map((c) => ({
      case_id: c.case_id,
      body_text_source: c.body_text_source,
      old_semantic_chars: c.old_semantic_chars,
      new_semantic_chars: c.semantic_text_chars,
      snippet_chars: c.snippet_chars,
      old_equals_new: c.old_equals_new,
      semantic_equals_snippet: c.semantic_equals_snippet,
      body_text_truncated: c.body_text_truncated,
      semantic_text_truncated: c.semantic_text_truncated,
    })),
    conclusion: oldVersions.includes(EXPECTED_NORMALIZER)
      ? 'OLD_BUNDLE_NORMALIZER_MATCHED_EXPECTED_REVIEW_LENGTH_DIFFS'
      : 'OLD_H1_USED_STALE_MAILLENS_NORMALIZER_REBUILD_REQUIRED',
  };

  const bundleOut = path.join(outDir, 'real60-h1-blind-bundle-maillens-v1.1-private-local.json');
  const auditOut = path.join(outDir, 'real60-h1-maillens-audit-v2.json');
  await writeFile(bundleOut, JSON.stringify(rebuilt, null, 2) + '\n', 'utf8');
  await writeFile(auditOut, JSON.stringify(audit, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('================ MAILLENS H1 AUDIT ================');
  console.log(`Old normalizer(s):        ${oldVersions.join(', ')}`);
  console.log(`Expected/new normalizer:  ${EXPECTED_NORMALIZER}`);
  console.log(`Body source counts:       ${JSON.stringify(sourceCounts)}`);
  console.log(`New text longer than old: ${semanticLongerThanOld}/60`);
  console.log(`New text == old:          ${semanticEqualOld}/60`);
  console.log(`New text == snippet:      ${semanticEqualsSnippet}/60`);
  console.log(`Hydrated detached bodies: ${totalHydrated}`);
  console.log(`Audit:                    ${auditOut}`);
  console.log(`Rebuilt blind bundle:     ${bundleOut}`);
  console.log(`Conclusion:               ${audit.conclusion}`);
  console.log('No OpenAI calls | Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('===================================================');
}

main().catch((error) => {
  console.error(`MAILLENS_H1_AUDIT_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
