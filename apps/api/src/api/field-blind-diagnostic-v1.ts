import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { FIELD_BLIND_GROUND_TRUTH_V1, type BlindExpectation } from './field-blind-ground-truth-v1.js';

const COMMERCE_LABEL = 'BuyFlow Field Blind/v1 Commerce';
const NOISE_LABEL = 'BuyFlow Field Blind/v1 Noise';
const FIELDS = ['eventType','merchant','orderNumber','total','currency','carrier','trackingNumber','paymentStatus','products'] as const;
type FieldName = typeof FIELDS[number];

function normString(v: string | null | undefined) { return (v ?? '').normalize('NFKC').trim().toLowerCase(); }
function normValue(v: unknown) { return typeof v === 'string' ? normString(v) : v; }
function same(a: unknown, b: unknown) { return JSON.stringify(normValue(a)) === JSON.stringify(normValue(b)); }
function text(email: NormalizedEmail) { return `${email.subject ?? ''}\n${email.snippet ?? ''}\n${email.bodyHtml ?? ''}`; }
function compact(result: Record<string, unknown> | null) {
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
function actual(plan: ReturnType<typeof planNormalizedInboundEmail>) {
  const r = plan.validatedResult ?? plan.structuredResult;
  return {
    eventType: r.event_type ?? plan.classification ?? null,
    merchant: r.merchant ?? r.merchant_legal_name ?? null,
    orderNumber: r.order_number ?? null,
    total: r.total ?? null,
    currency: r.currency ?? null,
    carrier: r.carrier ?? null,
    trackingNumber: r.tracking_number ?? null,
    paymentStatus: r.payment_status ?? null,
    products: Array.isArray(r.products) ? r.products : [],
  } as Record<FieldName, unknown>;
}
function evalField(expected: BlindExpectation<unknown>, value: unknown) {
  if (expected.state === 'not_asserted') return { asserted:false, pass:true, expected:'not_asserted', actual:value };
  if (expected.state === 'null') return { asserted:true, pass:value == null || (Array.isArray(value) && value.length === 0), expected:null, actual:value };
  return { asserted:true, pass:same(expected.value, value), expected:expected.value, actual:value };
}
async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) { await reply.code(401).send({ error:'unauthorized' }); return null; }
  return user;
}
async function loadLabel(provider: ReturnType<typeof createEmailProvider>, label: string) {
  const out: NormalizedEmail[] = []; let cursor: string | undefined; let scanned = 0;
  do {
    const page = await provider.searchMessages({ query:`label:\"${label}\" -in:spam -in:trash`, limit:100, ...(cursor ? { cursor } : {}) });
    out.push(...page.messages); scanned += page.messages.length; cursor = page.nextCursor;
  } while (cursor && scanned < 2000);
  return out;
}

async function run(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db.from('email_connections').select('provider_account_id').eq('user_id',userId).eq('provider','nylas').eq('status','active').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');
  const provider = createEmailProvider({ provider:'nylas', providerAccountId:connection.provider_account_id });
  const [commerce, noise] = await Promise.all([loadLabel(provider, COMMERCE_LABEL), loadLabel(provider, NOISE_LABEL)]);

  const commerceRows = FIELD_BLIND_GROUND_TRUTH_V1.map((truth) => {
    const email = commerce.find((m) => normString(m.from[0]?.email) === normString(truth.selector.sender)
      && normString(m.subject) === normString(truth.selector.subject)
      && (!truth.selector.contains || normString(text(m)).includes(normString(truth.selector.contains))));
    if (!email) return { id:truth.id, found:false, critical:true, failures:['missing_email'], expected:truth, structured:null, validated:null };
    const plan = planNormalizedInboundEmail({ email });
    const values = actual(plan);
    const fields = FIELDS.map((name) => ({ name, ...evalField(truth[name] as BlindExpectation<unknown>, values[name]) }));
    const failures = fields.filter((f) => f.asserted && !f.pass).map((f) => f.name);
    const critical = !plan.classification || failures.some((name) => ['eventType','orderNumber','total','currency','carrier','trackingNumber','paymentStatus'].includes(name));
    return {
      id:truth.id, found:true, sender:email.from[0]?.email ?? null, subject:email.subject ?? null,
      classification:plan.classification, parserVersion:plan.parserVersion, validationStatus:plan.validationStatus,
      critical, failures, expected:Object.fromEntries(FIELDS.map((name)=>[name, truth[name]])),
      structured:compact(plan.structuredResult), validated:compact(plan.validatedResult), fields,
    };
  });

  const falsePositives = noise.map((email) => {
    const plan = planNormalizedInboundEmail({ email });
    return {
      sender:email.from[0]?.email ?? null, subject:email.subject ?? null, recognized:Boolean(plan.classification),
      classification:plan.classification, parserVersion:plan.parserVersion, validationStatus:plan.validationStatus,
      structured:compact(plan.structuredResult), validated:compact(plan.validatedResult),
    };
  }).filter((row) => row.recognized);

  const criticalRows = commerceRows.filter((row) => row.critical);
  const failureCounts = Object.fromEntries(FIELDS.map((name) => [name, criticalRows.filter((r:any) => Array.isArray(r.failures) && r.failures.includes(name)).length]));
  return { ok:true, mode:'blind-diagnostic', productionWrites:0, aiCalls:0, falsePositiveCount:falsePositives.length, criticalMismatchCount:criticalRows.length, failureCounts, falsePositives, criticalRows };
}

function page() {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Blind Diagnostic v1</title><style>body{font-family:system-ui;background:#071020;color:#fff;margin:0}main{max-width:1200px;margin:auto;padding:28px}.card{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}.row{border-top:1px solid #ffffff18;padding:16px 0}.bad{color:#ff7d9d}.muted{color:#9eacd0}button{padding:12px 16px;border:0;border-radius:12px;background:#7c4dff;color:#fff;font-weight:700}pre{white-space:pre-wrap;word-break:break-word;background:#071020;padding:12px;border-radius:12px}.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:900px){.cols{grid-template-columns:1fr}}</style></head><body><main><div class="card"><b>BLIND DIAGNOSTIC · BASELINE PRESERVED · 0 WRITE · 0 AI</b><h1>False positives + critical field mismatches</h1><button id="run">Diagnosztika futtatása</button> <span id="s" class="muted"></span></div><div id="o" class="card" hidden></div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const c=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp'),b=document.querySelector('#run'),o=document.querySelector('#o'),s=document.querySelector('#s');const esc=v=>String(v??'').replace(/[&<>]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[x]));const pretty=v=>esc(JSON.stringify(v,null,2));b.onclick=async()=>{const{data}=await c.auth.getSession();if(!data.session){s.textContent='Jelentkezz be.';return}b.disabled=true;s.textContent='Fut…';try{const r=await fetch('/api/audit/field-blind-diagnostic-v1',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}}),d=await r.json();if(!r.ok)throw new Error(d.error||'hiba');o.hidden=false;o.innerHTML='<h2 class="bad">False positive: '+d.falsePositiveCount+' · Critical mismatch: '+d.criticalMismatchCount+'</h2><h3>Hibacsaládok</h3><pre>'+pretty(d.failureCounts)+'</pre><h3>False positive-ok</h3>'+(d.falsePositives||[]).map(x=>'<div class="row"><b>'+esc(x.subject)+'</b><div class="muted">'+esc(x.sender)+' · '+esc(x.classification)+' · '+esc(x.parserVersion)+'</div><div class="cols"><pre>'+pretty(x.structured)+'</pre><pre>'+pretty(x.validated)+'</pre></div></div>').join('')+'<h3>Critical field hibák</h3>'+(d.criticalRows||[]).map(x=>'<div class="row"><b>'+esc(x.subject||x.id)+'</b><div class="muted">fail: '+esc((x.failures||[]).join(', '))+' · '+esc(x.classification||'nincs')+' · '+esc(x.parserVersion||'nincs parser')+'</div><div class="cols"><div><b>Expected</b><pre>'+pretty(x.expected)+'</pre></div><div><b>Structured</b><pre>'+pretty(x.structured)+'</pre></div><div><b>Validated</b><pre>'+pretty(x.validated)+'</pre></div></div></div>').join('');s.textContent='Kész. 0 write · 0 AI.'}catch(e){s.textContent='Hiba: '+e.message}finally{b.disabled=false}};</script></body></html>`;
}

export async function registerFieldBlindDiagnosticV1(app: FastifyInstance) {
  app.get('/audit-fields-blind-diagnostic-v1', async (_q,r) => r.code(200).type('text/html; charset=utf-8').header('Cache-Control','no-store').send(page()));
  app.post('/api/audit/field-blind-diagnostic-v1', async (q,r) => { const user=await requireUser(q,r); if(!user)return; try{return r.code(200).send(await run(user.id));}catch(error){const code=error instanceof Error?error.message:'field_blind_diagnostic_failed';return r.code(code==='active_nylas_connection_not_found'?404:503).send({ok:false,error:code});} });
}
