import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { FIELD_GROUND_TRUTH_V1, FIELD_GROUND_TRUTH_V1_META, type GroundTruthExpectation } from './field-ground-truth-v1.js';

const LABEL = 'BuyFlow EML Audit/v7 Commerce';
const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;
const FIELDS = ['eventType','merchant','orderNumber','total','currency','carrier','trackingNumber','paymentStatus','products'] as const;
type FieldName = typeof FIELDS[number];

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) { await reply.code(401).send({ error: 'unauthorized' }); return null; }
  return user;
}

function norm(v: unknown) { return typeof v === 'string' ? v.normalize('NFKC').trim().toLowerCase() : v; }
function same(a: unknown, b: unknown) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
function actualFields(plan: ReturnType<typeof planNormalizedInboundEmail>) {
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
function evaluate<T>(expected: GroundTruthExpectation<T>, actual: unknown) {
  if (expected.state === 'not_asserted') return { asserted:false, pass:true, expected:'not_asserted', actual };
  if (expected.state === 'null') return { asserted:true, pass:actual == null || (Array.isArray(actual) && actual.length===0), expected:null, actual };
  return { asserted:true, pass:same(expected.value, actual), expected:expected.value, actual };
}

async function run(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db.from('email_connections').select('provider_account_id').eq('user_id',userId).eq('provider','nylas').eq('status','active').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');
  const provider = createEmailProvider({ provider:'nylas', providerAccountId:connection.provider_account_id });
  const messages: NormalizedEmail[] = [];
  let cursor: string|undefined; let scanned=0;
  do {
    const page = await provider.searchMessages({ query:`label:"${LABEL}" -in:spam -in:trash`, limit:PAGE_SIZE, ...(cursor?{cursor}:{}) });
    messages.push(...page.messages); scanned += page.messages.length; cursor=page.nextCursor;
  } while (cursor && scanned < MAX_SCAN);

  const rows = FIELD_GROUND_TRUTH_V1.map((truth) => {
    const email = messages.find((m) => norm(m.from[0]?.email ?? '')===norm(truth.selector.sender) && norm(m.subject ?? '')===norm(truth.selector.subject));
    if (!email) return { id:truth.id, found:false, criticalMismatch:false, fields:[] };
    const plan = planNormalizedInboundEmail({ email });
    const actual = actualFields(plan);
    const fields = FIELDS.map((name) => ({ name, ...evaluate(truth[name], actual[name]) }));
    const criticalMismatch = fields.some((f) => f.asserted && !f.pass && ['eventType','orderNumber','total','currency','carrier','trackingNumber','paymentStatus'].includes(f.name));
    return { id:truth.id, found:true, sender:email.from[0]?.email ?? null, subject:email.subject ?? null, parserVersion:plan.parserVersion, classification:plan.classification, criticalMismatch, fields };
  });

  const fieldSummary = Object.fromEntries(FIELDS.map((name) => {
    const evals = rows.flatMap((r:any) => r.fields ?? []).filter((f:any)=>f.name===name && f.asserted);
    const passed = evals.filter((f:any)=>f.pass).length;
    return [name,{asserted:evals.length,passed,failed:evals.length-passed,accuracy:evals.length?passed/evals.length:null}];
  }));
  const asserted = Object.values(fieldSummary).reduce((n:any,s:any)=>n+s.asserted,0) as number;
  const passed = Object.values(fieldSummary).reduce((n:any,s:any)=>n+s.passed,0) as number;
  return { ok:true, mode:'shadow', productionWrites:0, aiCalls:0, groundTruth:FIELD_GROUND_TRUTH_V1_META, expectedMessages:FIELD_GROUND_TRUTH_V1.length, foundMessages:rows.filter((r:any)=>r.found).length, assertedFields:asserted, passedFields:passed, overallAccuracy:asserted?passed/asserted:null, criticalMismatchCount:rows.filter((r:any)=>r.criticalMismatch).length, scanned, fieldSummary, rows };
}

function pageHtml() { return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Field Accuracy Audit v1</title><style>body{font-family:system-ui;background:#071020;color:#fff;margin:0}main{max-width:1100px;margin:auto;padding:28px}.card{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}button{padding:12px 16px;border:0;border-radius:12px;background:#7c4dff;color:#fff;font-weight:700}.ok{color:#63e6aa}.bad{color:#ff7d9d}.row{border-top:1px solid #ffffff18;padding:12px 0}.muted{color:#9eacd0}</style></head><body><main><div class="card"><b>FIELD GROUND TRUTH · SHADOW · 0 WRITE · 0 AI</b><h1>Field Accuracy Audit v1</h1><button id="run">Audit futtatása</button> <span id="status" class="muted"></span></div><div id="out" class="card" hidden></div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const s=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const b=document.querySelector('#run'),o=document.querySelector('#out'),st=document.querySelector('#status');const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';b.onclick=async()=>{const{data}=await s.auth.getSession();if(!data.session){st.textContent='Jelentkezz be.';return}b.disabled=true;st.textContent='Fut…';try{const r=await fetch('/api/audit/field-accuracy-v1',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}}),d=await r.json();if(!r.ok)throw new Error(d.error||'hiba');o.hidden=false;o.innerHTML='<h2>'+pct(d.overallAccuracy)+' overall</h2><p>Found '+d.foundMessages+'/'+d.expectedMessages+' · asserted '+d.assertedFields+' · critical mismatch <b class="'+(d.criticalMismatchCount?'bad':'ok')+'">'+d.criticalMismatchCount+'</b></p>'+Object.entries(d.fieldSummary).map(([k,v])=>'<div class="row"><b>'+k+'</b> · '+pct(v.accuracy)+' · '+v.passed+'/'+v.asserted+'</div>').join('');st.textContent='Kész. 0 write · 0 AI.'}catch(e){st.textContent='Hiba: '+e.message}finally{b.disabled=false}};</script></body></html>`; }

export async function registerFieldAccuracyAuditV1(app: FastifyInstance) {
  app.get('/audit-fields-v1', async (_req,reply)=>reply.code(200).type('text/html; charset=utf-8').header('Cache-Control','no-store').send(pageHtml()));
  app.post('/api/audit/field-accuracy-v1', async (request,reply)=>{ const user=await requireUser(request,reply); if(!user)return; try{return reply.code(200).send(await run(user.id));}catch(error){const code=error instanceof Error?error.message:'field_accuracy_audit_failed';return reply.code(code==='active_nylas_connection_not_found'?404:503).send({ok:false,error:code});} });
}
