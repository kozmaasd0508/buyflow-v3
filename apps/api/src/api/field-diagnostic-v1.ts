import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { FIELD_GROUND_TRUTH_V1 } from './field-ground-truth-v1.js';

const LABEL = 'BuyFlow EML Audit/v7 Commerce';
const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function norm(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase()
    : value;
}

function expectedSnapshot(truth: (typeof FIELD_GROUND_TRUTH_V1)[number]) {
  return Object.fromEntries(
    Object.entries(truth)
      .filter(([key]) => !['id', 'selector'].includes(key))
      .map(([key, expectation]) => {
        if (!expectation || typeof expectation !== 'object' || !('state' in expectation)) {
          return [key, { state: 'not_asserted' }];
        }
        return [key, expectation];
      }),
  );
}

function compactExtraction(result: Record<string, unknown> | null) {
  if (!result) return null;
  return {
    event_type: result.event_type ?? null,
    merchant: result.merchant ?? null,
    merchant_legal_name: result.merchant_legal_name ?? null,
    order_number: result.order_number ?? null,
    total: result.total ?? null,
    currency: result.currency ?? null,
    carrier: result.carrier ?? null,
    tracking_number: result.tracking_number ?? null,
    payment_status: result.payment_status ?? null,
    products: Array.isArray(result.products) ? result.products : [],
    validation_status: result.validation_status ?? null,
    blocked_fields: Array.isArray(result.blocked_fields) ? result.blocked_fields : [],
    reasons: Array.isArray(result.reasons) ? result.reasons : [],
  };
}

async function run(userId: string) {
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

  const messages: NormalizedEmail[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await provider.searchMessages({
      query: `label:\"${LABEL}\" -in:spam -in:trash`,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    messages.push(...page.messages);
    scanned += page.messages.length;
    cursor = page.nextCursor;
  } while (cursor && scanned < MAX_SCAN);

  const rows = FIELD_GROUND_TRUTH_V1.map((truth) => {
    const email = messages.find((message) =>
      norm(message.from[0]?.email ?? '') === norm(truth.selector.sender)
      && norm(message.subject ?? '') === norm(truth.selector.subject));

    if (!email) {
      return {
        id: truth.id,
        found: false,
        selector: truth.selector,
        expected: expectedSnapshot(truth),
      };
    }

    const plan = planNormalizedInboundEmail({ email });
    return {
      id: truth.id,
      found: true,
      sender: email.from[0]?.email ?? null,
      subject: email.subject ?? null,
      classification: plan.classification,
      parserVersion: plan.parserVersion,
      validationStatus: plan.validationStatus,
      expected: expectedSnapshot(truth),
      structured: compactExtraction(plan.structuredResult),
      validated: compactExtraction(plan.validatedResult),
      structuredResult: plan.structuredResult,
      validatedResult: plan.validatedResult,
    };
  });

  return {
    ok: true,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    expectedMessages: FIELD_GROUND_TRUTH_V1.length,
    foundMessages: rows.filter((row) => row.found).length,
    scanned,
    rows,
  };
}

function pageHtml() {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Field Diagnostic v1</title><style>body{font-family:system-ui;background:#071020;color:#fff;margin:0}main{max-width:1200px;margin:auto;padding:28px}.card{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}button{padding:12px 16px;border:0;border-radius:12px;background:#7c4dff;color:#fff;font-weight:700}.muted{color:#9eacd0}.row{border-top:1px solid #ffffff18;padding:16px 0}pre{white-space:pre-wrap;word-break:break-word;background:#071020;padding:12px;border-radius:12px;overflow:auto}.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:900px){.cols{grid-template-columns:1fr}}</style></head><body><main><div class="card"><b>FIELD DIAGNOSTIC · SHADOW · 0 WRITE · 0 AI</b><h1>Expected → structured → validated</h1><button id="run">Diagnosztika futtatása</button> <span id="status" class="muted"></span></div><div id="out" class="card" hidden></div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const s=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const b=document.querySelector('#run'),o=document.querySelector('#out'),st=document.querySelector('#status');const esc=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));const pretty=v=>esc(JSON.stringify(v,null,2));b.onclick=async()=>{const{data}=await s.auth.getSession();if(!data.session){st.textContent='Jelentkezz be.';return}b.disabled=true;st.textContent='Fut…';try{const r=await fetch('/api/audit/field-diagnostic-v1',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}}),d=await r.json();if(!r.ok)throw new Error(d.error||'hiba');o.hidden=false;o.innerHTML='<h2>Found '+d.foundMessages+'/'+d.expectedMessages+'</h2>'+(d.rows||[]).map(x=>'<div class="row"><h3>'+esc(x.subject||x.id)+'</h3><div class="muted">'+esc(x.sender||'missing')+' · '+esc(x.classification||'nincs')+' · '+esc(x.parserVersion||'nincs parser')+'</div><div class="cols"><div><b>Expected</b><pre>'+pretty(x.expected)+'</pre></div><div><b>Structured</b><pre>'+pretty(x.structured)+'</pre></div><div><b>Validated</b><pre>'+pretty(x.validated)+'</pre></div></div></div>').join('');st.textContent='Kész. 0 write · 0 AI.'}catch(e){st.textContent='Hiba: '+e.message}finally{b.disabled=false}};</script></body></html>`;
}

export async function registerFieldDiagnosticV1(app: FastifyInstance) {
  app.get('/audit-fields-diagnostic-v1', async (_request, reply) => reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(pageHtml()));

  app.post('/api/audit/field-diagnostic-v1', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      return reply.code(200).send(await run(user.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'field_diagnostic_failed';
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
