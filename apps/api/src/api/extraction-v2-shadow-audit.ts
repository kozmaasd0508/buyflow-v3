import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
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

const STATUS_NAMES: ShadowComparisonStatus[] = [
  'same',
  'legacy_only',
  'v2_only',
  'different',
  'both_missing',
  'v2_conflict',
];

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
body{font-family:system-ui;background:#071020;color:#fff;max-width:1180px;margin:auto;padding:28px}.c{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}button,select{padding:11px 14px;border:0;border-radius:10px;font-weight:700}button{background:#7c4dff;color:#fff}.muted{color:#9fb0c9}.bad{color:#ff9b9b}.good{color:#8ef0ba}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #263551}code{white-space:pre-wrap;word-break:break-word;color:#dfe7ff}
</style>
<div class="c"><b>EXTRACTION ENGINE v2 · SHADOW DIFFERENTIAL · 0 WRITE · 0 AI</b><h1>Old engine vs Extraction Engine v2</h1><p class="muted">Ez nem ground truth pontosság. Csak azt mutatja, hol egyezik vagy tér el a két motor.</p><select id="n"><option value="100">100 levél</option><option value="200" selected>200 levél</option><option value="300">300 levél</option><option value="500">500 levél</option></select> <button id="b">Shadow audit futtatása</button> <span id="s"></span></div>
<div class="c" id="o"></div>
<script type="module">
import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');
const esc=v=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));const fmt=v=>v==null?'null':typeof v==='string'?v:JSON.stringify(v);
b.onclick=async()=>{const{x,data}=await c.auth.getSession();if(!data.session){s.textContent=' Jelentkezz be.';return}s.textContent=' Fut…';o.innerHTML='';try{const r=await fetch('/api/audit/extraction-v2-shadow?limit='+encodeURIComponent(n.value),{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}});const d=await r.json();if(!r.ok)throw new Error(d.error||'audit_failed');const statuses=['same','legacy_only','v2_only','different','v2_conflict','both_missing'];const fieldRows=Object.entries(d.perField).map(([f,v])=>'<tr><td>'+esc(f)+'</td>'+statuses.map(k=>'<td>'+Number(v[k]||0)+'</td>').join('')+'</tr>').join('');const details=d.rows.map(x=>'<h3>'+esc(x.messageId)+' · legacy '+esc(x.legacyClassification||'—')+' · v2 '+esc(x.v2EventType||'—')+(x.v2ReviewRequired?' · <span class="bad">REVIEW</span>':'')+'</h3><table><tr><th>Field</th><th>Status</th><th>Legacy</th><th>v2</th></tr>'+x.differences.map(f=>'<tr><td>'+esc(f.field)+'</td><td>'+esc(f.status)+'</td><td><code>'+esc(fmt(f.legacy))+'</code></td><td><code>'+esc(fmt(f.v2))+'</code></td></tr>').join('')+'</table>').join('');o.innerHTML='<h2>'+d.scanned+' levél összehasonlítva</h2><p>Legacy recognized: '+d.legacyRecognized+' · v2 recognized: '+d.v2Recognized+' · v2 REVIEW: '+d.v2Review+'</p><p class="muted">Accuracy claimed: NO · 0 write · 0 AI</p><table><tr><th>Field</th>'+statuses.map(k=>'<th>'+k+'</th>').join('')+'</tr>'+fieldRows+'</table><h2>Eltérések (max. 100)</h2>'+details;s.textContent=' Kész.'}catch(e){s.textContent=' Hiba: '+e.message}};
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
