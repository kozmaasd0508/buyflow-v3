import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;

type ExpectedKind = 'commerce' | 'noise';
interface CuratedFixture { id: string; expectedKind: ExpectedKind }

// Frozen in Gmail before the first v7 run. Ground truth remains exclusively in Gmail;
 // no sender addresses or subject lines are copied into the repository.
const COMMERCE_LABEL_V7 = 'BuyFlow EML Audit/v7 Commerce';
const NOISE_LABEL_V7 = 'BuyFlow EML Audit/v7 Noise';
const HOLDOUT_LABEL_V7 = 'BuyFlow EML Audit/v7 Holdout';
const EXPECTED_PER_KIND_V7 = 50;
const EXPECTED_TOTAL_V7 = EXPECTED_PER_KIND_V7 * 2;

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) { await reply.code(401).send({ error: 'unauthorized' }); return null; }
  return user;
}

function norm(value: string) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}
function detectedCommerce(classification: string | null) { return Boolean(classification && classification !== 'other' && !classification.startsWith('security_')); }

function audit(fixture: CuratedFixture, email: NormalizedEmail) {
  const plan = planNormalizedInboundEmail({ email });
  const commerce = detectedCommerce(plan.classification);
  const verdict = fixture.expectedKind === 'commerce'
    ? (commerce ? 'true_positive' : 'false_negative')
    : (commerce ? 'false_positive' : 'true_negative');
  return {
    id: fixture.id,
    expectedKind: fixture.expectedKind,
    sender: email.from[0]?.email ?? null,
    subject: email.subject ?? null,
    classification: plan.classification,
    parserVersion: plan.parserVersion,
    recognitionStatus: plan.status,
    validationStatus: plan.validationStatus,
    detectedCommerce: commerce,
    verdict,
    productionWrites: 0,
    aiCalls: 0,
  };
}

function summarize(rows: Array<Record<string, unknown>>) {
  const count = (v: string) => rows.filter((r) => r.verdict === v).length;
  const tp = count('true_positive');
  const fn = count('false_negative');
  const fp = count('false_positive');
  const tn = count('true_negative');
  return {
    truePositive: tp,
    falseNegative: fn,
    falsePositive: fp,
    trueNegative: tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
  };
}

async function runAuditV7(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db
    .from('email_connections')
    .select('id,provider_account_id,email_address')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: connection.provider_account_id });
  let scanned = 0;

  async function scanLabel(expectedKind: ExpectedKind, label: string) {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const page = await provider.searchMessages({
        query: `label:"${label}" -in:spam -in:trash`,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      for (const email of page.messages) {
        scanned += 1;
        rows.push(audit({
          id: `${expectedKind}-v7-${String(rows.length + 1).padStart(2, '0')}`,
          expectedKind,
        }, email));
        if (rows.length >= EXPECTED_PER_KIND_V7 || scanned >= MAX_SCAN) break;
      }
      if (rows.length >= EXPECTED_PER_KIND_V7 || scanned >= MAX_SCAN) break;
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  }

  const commerceRows = await scanLabel('commerce', COMMERCE_LABEL_V7);
  const noiseRows = await scanLabel('noise', NOISE_LABEL_V7);
  const rows = [...commerceRows, ...noiseRows];
  const missing = [
    ...(commerceRows.length === EXPECTED_PER_KIND_V7 ? [] : [{ expectedKind: 'commerce', expected: EXPECTED_PER_KIND_V7, actual: commerceRows.length }]),
    ...(noiseRows.length === EXPECTED_PER_KIND_V7 ? [] : [{ expectedKind: 'noise', expected: EXPECTED_PER_KIND_V7, actual: noiseRows.length }]),
  ];

  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-curated-mailbox-v7-holdout',
    groundTruth: {
      commerce: EXPECTED_PER_KIND_V7,
      noise: EXPECTED_PER_KIND_V7,
      frozenBeforeFirstRun: true,
      gmailLabels: [COMMERCE_LABEL_V7, NOISE_LABEL_V7, HOLDOUT_LABEL_V7],
      detectorBaselineCommit: '2f8e3e2d39c8e9e94fce9cf671a47d0e401a48ce',
      fixtureMetadataStoredInRepository: false,
    },
    productionWrites: 0,
    aiCalls: 0,
    expectedTotal: EXPECTED_TOTAL_V7,
    matchedTotal: rows.length,
    coverage: rows.length / EXPECTED_TOTAL_V7,
    scanned,
    summary: summarize(rows),
    missing,
    rows,
  };
}

function pageHtml(): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Holdout Audit v7</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1120px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:42px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:28px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.row{display:grid;grid-template-columns:120px 1fr 90px;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Holdout Audit v7</strong><a class="back" href="/audit-v6">v6 regression</a></div><section class="card"><div class="eyebrow">BLIND SET · SHADOW · 0 WRITE · 0 AI</div><h1>100 új email</h1><p>50 commerce + 50 nehéz noise. A Gmailben előre lefagyasztott v7 holdoutot ugyanaz a determinisztikus BuyFlow motor értékeli; ez az oldal nem módosít production adatot és nem hív AI-t.</p><button id="run">Audit v7 futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},bad=(s.falseNegative||0)+(s.falsePositive||0),rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join(''),missing=(d.missing||[]).map(r=>'<div class="row"><span class="pill bad">missing</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(d.matchedTotal)+'/'+esc(d.expectedTotal)+'</strong><span>megtalált</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>hiba</span></div></div><p class="muted">TP '+esc(s.truePositive)+' · FN '+esc(s.falseNegative)+' · FP '+esc(s.falsePositive)+' · TN '+esc(s.trueNegative)+' · Scanned '+esc(d.scanned)+'</p>'+rows+missing}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Audit fut…';try{const res=await fetch('/api/audit/curated-mailbox-v7',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerCuratedMailboxAuditV7(app: FastifyInstance) {
  app.get('/audit-v7', async (_request, reply) => reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()));
  app.post('/api/audit/curated-mailbox-v7', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const result = await runAuditV7(user.id);
      request.log.info({ userId: user.id, expectedTotal: result.expectedTotal, matchedTotal: result.matchedTotal, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Fresh holdout mailbox audit v7 completed');
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'curated_audit_v7_failed';
      request.log.error({ code }, 'Fresh holdout mailbox audit v7 failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
