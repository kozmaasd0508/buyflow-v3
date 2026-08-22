import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { BLIND_V2_COMMERCE, BLIND_V2_NOISE } from './field-blind-holdout-v2-truth.js';
import type { GroundTruthExpectation } from './field-ground-truth-v1.js';

const FIELDS = [
  'eventType',
  'merchant',
  'orderNumber',
  'total',
  'currency',
  'carrier',
  'trackingNumber',
  'paymentStatus',
  'products',
] as const;

type FieldName = typeof FIELDS[number];

const ids = new Set([
  ...BLIND_V2_COMMERCE.map((x) => x.messageId),
  ...BLIND_V2_NOISE,
]);

const normalize = (value: unknown) => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLowerCase()
  : value;

const same = (actual: unknown, expected: unknown) => JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));

function actualFields(plan: ReturnType<typeof planNormalizedInboundEmail>) {
  const result = plan.validatedResult ?? plan.structuredResult;
  return {
    eventType: result.event_type ?? plan.classification ?? null,
    merchant: result.merchant ?? result.merchant_legal_name ?? null,
    orderNumber: result.order_number ?? null,
    total: result.total ?? null,
    currency: result.currency ?? null,
    carrier: result.carrier ?? null,
    trackingNumber: result.tracking_number ?? null,
    paymentStatus: result.payment_status ?? null,
    products: Array.isArray(result.products) ? result.products : [],
  } as Record<FieldName, unknown>;
}

function expectationValue(expectation: GroundTruthExpectation<unknown>): unknown {
  if (expectation.state === 'not_asserted') return undefined;
  if (expectation.state === 'null') return null;
  return expectation.value;
}

function evaluate(expectation: GroundTruthExpectation<unknown>, actual: unknown) {
  if (expectation.state === 'not_asserted') return { asserted: false, pass: true };
  if (expectation.state === 'null') {
    return {
      asserted: true,
      pass: actual == null || (Array.isArray(actual) && actual.length === 0),
    };
  }
  return { asserted: true, pass: same(actual, expectation.value) };
}

async function resolveUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

async function run(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection } = await db
    .from('email_connections')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });

  let cursor: string | undefined;
  let scanned = 0;
  const found = new Map<string, NormalizedEmail>();

  do {
    const page = await provider.searchMessages({
      query: '-in:spam -in:trash',
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const message of page.messages) {
      if (ids.has(message.providerMessageId)) found.set(message.providerMessageId, message);
    }
    scanned += page.messages.length;
    cursor = page.nextCursor;
  } while (cursor && scanned < 4000 && found.size < ids.size);

  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  let asserted = 0;
  let passed = 0;
  let criticalMismatchCount = 0;

  const summary = Object.fromEntries(FIELDS.map((field) => [field, {
    asserted: 0,
    passed: 0,
    failed: 0,
    accuracy: null as number | null,
  }]));

  const rows: any[] = [];

  for (const truth of BLIND_V2_COMMERCE) {
    const message = found.get(truth.messageId);
    if (!message) {
      fn += 1;
      rows.push({ messageId: truth.messageId, found: false, truth: 'commerce' });
      continue;
    }

    const plan = planNormalizedInboundEmail({ email: message });
    const detected = !!plan.classification && plan.classification !== 'other';
    if (detected) tp += 1;
    else fn += 1;

    const actual = actualFields(plan);
    let criticalMismatch = false;
    const fields = FIELDS.map((name) => {
      const expectation = truth[name] as GroundTruthExpectation<unknown>;
      const result = evaluate(expectation, actual[name]);
      if (result.asserted) {
        asserted += 1;
        (summary[name] as any).asserted += 1;
        if (result.pass) {
          passed += 1;
          (summary[name] as any).passed += 1;
        } else {
          (summary[name] as any).failed += 1;
          if ([
            'eventType',
            'orderNumber',
            'total',
            'currency',
            'carrier',
            'trackingNumber',
            'paymentStatus',
          ].includes(name)) criticalMismatch = true;
        }
      }
      return {
        name,
        ...result,
        expected: expectationValue(expectation),
        actual: actual[name],
      };
    });

    if (criticalMismatch) criticalMismatchCount += 1;
    rows.push({
      messageId: truth.messageId,
      found: true,
      truth: 'commerce',
      detected,
      classification: plan.classification,
      parserVersion: plan.parserVersion,
      criticalMismatch,
      fields,
    });
  }

  for (const id of BLIND_V2_NOISE) {
    const message = found.get(id);
    if (!message) {
      rows.push({ messageId: id, found: false, truth: 'noise' });
      continue;
    }
    const plan = planNormalizedInboundEmail({ email: message });
    const detected = !!plan.classification && plan.classification !== 'other';
    if (detected) fp += 1;
    else tn += 1;
    rows.push({
      messageId: id,
      found: true,
      truth: 'noise',
      detected,
      classification: plan.classification,
      parserVersion: plan.parserVersion,
    });
  }

  for (const name of FIELDS) {
    const field = summary[name] as any;
    field.accuracy = field.asserted ? field.passed / field.asserted : null;
  }

  return {
    ok: true,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    frozenBeforeRun: true,
    expectedMessages: ids.size,
    foundMessages: found.size,
    scanned,
    detection: {
      tp,
      fn,
      fp,
      tn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    },
    fields: {
      asserted,
      passed,
      accuracy: asserted ? passed / asserted : null,
      criticalMismatchCount,
      summary,
    },
    rows,
  };
}

function html() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind Field Holdout v2</title>
<style>
body{font-family:system-ui;background:#071020;color:#fff;max-width:1100px;margin:auto;padding:28px}
.c{background:#0d1830;padding:20px;border-radius:18px;margin:14px}
button{padding:12px;border:0;border-radius:10px;background:#7c4dff;color:white;font-weight:700}
.bad{color:#ff9b9b}.good{color:#8ef0ba}.muted{color:#9fb0c9}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #263551}code{white-space:pre-wrap;word-break:break-word;color:#dfe7ff}
</style>
<div class="c"><b>BLIND FIELD HOLDOUT v2 · ORIGINAL TRUTH FROZEN BEFORE FIRST RUN · 0 WRITE · 0 AI</b><h1>Field Blind Holdout v2</h1><p class="muted">Az első vakfutás után ez az oldal diagnosztikai/regressziós nézetként használható.</p><button id="b">Audit újrafuttatása</button><span id="s"></span></div>
<div class="c" id="o"></div>
<script type="module">
import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const c=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');
const esc=v=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=v=>v===undefined?'—':v===null?'null':typeof v==='string'?v:JSON.stringify(v);
b.onclick=async()=>{const{x,data}=await c.auth.getSession();if(!data.session){s.textContent=' Jelentkezz be.';return}s.textContent=' Fut…';const r=await fetch('/api/audit/field-blind-v2',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}}),d=await r.json(),p=v=>v==null?'—':(v*100).toFixed(1)+'%';
const commerce=d.rows.filter(x=>x.truth==='commerce');
const detail=commerce.map((row,i)=>{const failed=(row.fields||[]).filter(f=>f.asserted&&!f.pass);if(!row.found)return '<h3 class="bad">C'+(i+1)+' · message missing</h3>';if(!failed.length)return '<h3 class="good">C'+(i+1)+' · PASS · '+esc(row.parserVersion||'—')+'</h3>';return '<h3 class="bad">C'+(i+1)+' · '+esc(row.classification||'NO DETECTION')+' · '+esc(row.parserVersion||'—')+'</h3><table><tr><th>Field</th><th>Expected</th><th>Actual</th></tr>'+failed.map(f=>'<tr><td>'+esc(f.name)+'</td><td><code>'+esc(fmt(f.expected))+'</code></td><td><code>'+esc(fmt(f.actual))+'</code></td></tr>').join('')+'</table>'}).join('');
o.innerHTML='<h2>Detection: '+p(d.detection.precision)+' precision · '+p(d.detection.recall)+' recall</h2><p>TP '+d.detection.tp+' · FN '+d.detection.fn+' · FP '+d.detection.fp+' · TN '+d.detection.tn+'</p><h2>Fields: '+p(d.fields.accuracy)+'</h2><p>Found '+d.foundMessages+'/'+d.expectedMessages+' · asserted '+d.fields.asserted+' · critical mismatch '+d.fields.criticalMismatchCount+'</p>'+Object.entries(d.fields.summary).map(([k,v])=>'<p>'+k+' · '+p(v.accuracy)+' · '+v.passed+'/'+v.asserted+'</p>').join('')+'<h2>Mismatch diagnostics</h2>'+detail;s.textContent=' Kész. 0 write · 0 AI.'};
</script>`;
}

export async function registerFieldBlindHoldoutV2(app: FastifyInstance) {
  app.get('/audit-fields-blind-v2', async (_request, reply) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(html()));

  app.post('/api/audit/field-blind-v2', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      return reply.send(await run(user.id));
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        error: error instanceof Error ? error.message : 'blind_v2_failed',
      });
    }
  });
}
