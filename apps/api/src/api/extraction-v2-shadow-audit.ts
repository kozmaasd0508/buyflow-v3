import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { currentMessageLines } from '../extraction-v2/event-type-extractor.js';
import {
  compareLegacyAndExtractionV2,
  type ShadowComparisonStatus,
} from '../pipeline/extraction-v2-shadow-comparison.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const FIELD_NAMES = [
  'eventType',
  'merchant',
  'orderNumber',
  'total',
  'currency',
  'carrier',
  'trackingNumber',
  'paymentStatus',
  'invoiceNumber',
  'paymentReference',
  'products',
] as const;

type FieldName = typeof FIELD_NAMES[number];

async function resolveUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function sampleLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) return 200;
  return Math.min(500, Math.max(50, parsed));
}

function emptyCounts(): Record<ShadowComparisonStatus, number> {
  return {
    same: 0,
    legacy_only: 0,
    v2_only: 0,
    different: 0,
    both_missing: 0,
    v2_conflict: 0,
  };
}

function normalizedCueText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function redactCue(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function diagnosticCues(
  message: { subject?: string | null; snippet?: string | null },
  differences: Array<{ legacy?: unknown }>,
) {
  const legacyTokens = differences
    .map((item) => item.legacy)
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter((value) => value.length >= 3);
  const keywordPattern = /\b(?:refund|reimbursement|visszater|jovair|credit|order|rendel|invoice|szamla|receipt|payment|fizet|total|osszesen|vegosszeg|shipment|delivery|szallit|csomag|carrier|futar)\w*/i;
  const lines = currentMessageLines(message.snippet ?? '')
    .filter((line) => {
      const normalized = normalizedCueText(line);
      return keywordPattern.test(normalized)
        || legacyTokens.some((token) => normalized.includes(normalizedCueText(token)));
    })
    .map(redactCue)
    .filter(Boolean)
    .slice(0, 4);

  return {
    subject: message.subject ? redactCue(message.subject) : null,
    lines,
  };
}

async function run(userId: string, limit: number) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db
    .from('email_connections')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });

  const perField = Object.fromEntries(FIELD_NAMES.map((field) => [field, emptyCounts()])) as Record<FieldName, Record<ShadowComparisonStatus, number>>;
  const total = emptyCounts();
  const rows: any[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let legacyRecognized = 0;
  let v2Recognized = 0;
  let v2Review = 0;

  while (scanned < limit) {
    const page = await provider.searchMessages({
      query: '-in:spam -in:trash',
      limit: Math.min(100, limit - scanned),
      ...(cursor ? { cursor } : {}),
    });
    if (page.messages.length === 0) break;

    for (const message of page.messages) {
      const comparison = compareLegacyAndExtractionV2(message);
      if (comparison.legacyClassification && comparison.legacyClassification !== 'other') legacyRecognized += 1;
      if (comparison.v2.eventType) v2Recognized += 1;
      if (comparison.v2ReviewRequired) v2Review += 1;

      const interesting: any[] = [];
      for (const field of comparison.fields) {
        total[field.status] += 1;
        perField[field.field][field.status] += 1;
        if (!['same', 'both_missing'].includes(field.status)) {
          interesting.push({
            field: field.field,
            status: field.status,
            legacy: field.legacy,
            v2: field.v2,
            evidence: comparison.v2EvidenceDiagnostics[field.field],
          });
        }
      }

      if (interesting.length > 0 && rows.length < 100) {
        rows.push({
          messageId: message.providerMessageId,
          legacyParserVersion: comparison.legacyParserVersion,
          legacyClassification: comparison.legacyClassification,
          v2EventType: comparison.v2.eventType,
          v2ReviewRequired: comparison.v2ReviewRequired,
          v2ConflictFields: comparison.v2ConflictFields,
          validationIssues: comparison.v2ValidationIssueCodes,
          diagnosticCues: diagnosticCues(message, interesting),
          differences: interesting,
        });
      }
    }

    scanned += page.messages.length;
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  return {
    ok: true,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    accuracyClaimed: false,
    note: 'Differential agreement only. This is not field accuracy and does not replace independent ground truth.',
    sampleLimit: limit,
    scanned,
    legacyRecognized,
    v2Recognized,
    v2Review,
    totals: total,
    perField,
    rows,
  };
}

function html() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Extraction Engine v2 Shadow Audit</title>
<style>
body{font-family:system-ui;background:#071020;color:#fff;max-width:1180px;margin:auto;padding:28px}.c{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}button,select{padding:11px 14px;border:0;border-radius:10px;font-weight:700}button{background:#7c4dff;color:#fff;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}.muted{color:#9fb0c9}.bad{color:#ff9b9b}.good{color:#8ef0ba}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #263551}code{white-space:pre-wrap;word-break:break-word;color:#dfe7ff}.ev{font-size:12px;color:#b8c6de}.cue{font-size:12px;color:#9fb0c9;margin:6px 0 10px}
</style>
<div class="c"><b>EXTRACTION ENGINE v2 · SHADOW DIFFERENTIAL · 0 WRITE · 0 AI</b><h1>Old engine vs Extraction Engine v2</h1><p class="muted">Ez nem ground truth pontosság. Csak azt mutatja, hol egyezik vagy tér el a két motor.</p><select id="n"><option value="100" selected>100 levél</option><option value="200">200 levél</option><option value="300">300 levél</option><option value="500">500 levél</option></select> <button id="b" type="button">Shadow audit futtatása</button> <span id="s"></span></div>
<div class="c" id="o"></div>
<script>
(() => {
  const button = document.getElementById('b');
  const status = document.getElementById('s');
  const output = document.getElementById('o');
  const limit = document.getElementById('n');
  if (!(button instanceof HTMLButtonElement) || !(status instanceof HTMLElement) || !(output instanceof HTMLElement) || !(limit instanceof HTMLSelectElement)) {
    return;
  }

  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (value) => value == null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value);
  const evidenceText = (items) => (items || []).map((item) => 'value=' + fmt(item.value) + ' · conf=' + Number(item.confidence).toFixed(3) + ' · ' + item.source + ' · ' + item.extractorId + ' · ' + (item.qualifiers || []).join(',')).join('\\n');
  const cueText = (cue) => {
    if (!cue) return '';
    const parts = [];
    if (cue.subject) parts.push('Subject: ' + cue.subject);
    if (cue.lines && cue.lines.length) parts.push('Cues: ' + cue.lines.join(' | '));
    return parts.join(' · ');
  };

  let clientPromise = null;
  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
        .then(({ createClient }) => createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp'));
    }
    return clientPromise;
  };

  const showError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = ' Hiba: ' + message;
    status.className = 'bad';
  };

  window.addEventListener('error', (event) => showError(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => showError(event.reason));

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.className = '';
    status.textContent = ' Indítás…';
    output.innerHTML = '';
    try {
      const client = await getClient();
      const { data, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) {
        status.textContent = ' Jelentkezz be a BuyFlow-ba, majd nyisd meg újra ezt az oldalt.';
        status.className = 'bad';
        return;
      }

      status.textContent = ' Fut…';
      const response = await fetch('/api/audit/extraction-v2-shadow?limit=' + encodeURIComponent(limit.value), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + data.session.access_token },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'audit_failed');

      const statuses = ['same','legacy_only','v2_only','different','v2_conflict','both_missing'];
      const fieldRows = Object.entries(payload.perField).map(([field, counts]) => '<tr><td>' + esc(field) + '</td>' + statuses.map((key) => '<td>' + Number(counts[key] || 0) + '</td>').join('') + '</tr>').join('');
      const details = payload.rows.map((row) => '<h3>' + esc(row.messageId) + ' · legacy ' + esc(row.legacyClassification || '—') + ' · v2 ' + esc(row.v2EventType || '—') + (row.v2ReviewRequired ? ' · <span class="bad">REVIEW</span>' : '') + '</h3><div class="cue">' + esc(cueText(row.diagnosticCues)) + '</div><table><tr><th>Field</th><th>Status</th><th>Legacy</th><th>v2</th><th>v2 evidence</th></tr>' + row.differences.map((field) => '<tr><td>' + esc(field.field) + '</td><td>' + esc(field.status) + '</td><td><code>' + esc(fmt(field.legacy)) + '</code></td><td><code>' + esc(fmt(field.v2)) + '</code></td><td><code class="ev">' + esc(evidenceText(field.evidence)) + '</code></td></tr>').join('') + '</table>').join('');

      output.innerHTML = '<h2>' + payload.scanned + ' levél összehasonlítva</h2><p>Legacy recognized: ' + payload.legacyRecognized + ' · v2 recognized: ' + payload.v2Recognized + ' · v2 REVIEW: ' + payload.v2Review + '</p><p class="muted">Accuracy claimed: NO · 0 write · 0 AI</p><table><tr><th>Field</th>' + statuses.map((key) => '<th>' + key + '</th>').join('') + '</tr>' + fieldRows + '</table><h2>Eltérések (max. 100)</h2>' + details;
      status.textContent = ' Kész.';
      status.className = 'good';
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });
})();
</script>`;
}

export async function registerExtractionV2ShadowAudit(app: FastifyInstance) {
  app.get('/audit-extraction-v2-shadow', async (_request, reply) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(html()));

  app.post<{ Querystring: { limit?: string } }>('/api/audit/extraction-v2-shadow', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      return reply.send(await run(user.id, sampleLimit(request.query.limit)));
    } catch (auditError) {
      request.log.error({
        errorType: auditError instanceof Error ? auditError.name : 'UnknownError',
      }, 'Extraction v2 shadow audit failed');
      return reply.code(503).send({
        ok: false,
        error: auditError instanceof Error ? auditError.message : 'extraction_v2_shadow_audit_failed',
      });
    }
  });
}
