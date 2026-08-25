import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 1_200;

type ExpectedKind = 'commerce' | 'noise';

interface CuratedFixture {
  id: string;
  expectedKind: ExpectedKind;
  sender: string;
  subject: string;
}

const CURATED_FIXTURES_V2: CuratedFixture[] = [
  { id: 'commerce-v2-01', expectedKind: 'commerce', sender: 'no-reply@expressone.hu', subject: 'Expressone értesítés' },
  { id: 'commerce-v2-02', expectedKind: 'commerce', sender: 'no-reply@expressone.hu', subject: 'Expressone értesítés #772013' },
  { id: 'commerce-v2-03', expectedKind: 'commerce', sender: 'ertesites@expressone.hu', subject: 'Csomag kézbesítés ma – ETA és módosítás' },
  { id: 'commerce-v2-04', expectedKind: 'commerce', sender: 'ertesites@expressone.hu', subject: 'Küldemény feldolgozása megkezdődött' },
  { id: 'commerce-v2-05', expectedKind: 'commerce', sender: 'info@fnp.hu', subject: 'A FNP Products rendelésed teljesített. Rendelésed átadtuk a futárnak.' },
  { id: 'commerce-v2-06', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380143879559 sikeres kézbesítéséről' },
  { id: 'commerce-v2-07', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380143879559 LPP Hungary Kft./FC PDK küldemény mai kézbesítéséről' },
  { id: 'commerce-v2-08', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380143879559 LPP Hungary Kft./FC PDK küldemény feladásáról' },
  { id: 'commerce-v2-09', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380124260518 sikeres kézbesítéséről' },
  { id: 'commerce-v2-10', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény mai kézbesítéséről' },
  { id: 'commerce-v2-11', expectedKind: 'commerce', sender: 'noreply@barion.com', subject: 'Sikeres fizetés' },
  { id: 'commerce-v2-12', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény feladásáról' },
  { id: 'commerce-v2-13', expectedKind: 'commerce', sender: 'noreply@sinsay.com', subject: 'Visszaigazolás arról, hogy a 15710474710 rendelést elküldték.' },
  { id: 'commerce-v2-14', expectedKind: 'commerce', sender: 'noreply@barion.com', subject: 'Sikeres fizetés' },
  { id: 'commerce-v2-15', expectedKind: 'commerce', sender: 'info@jatekbolt.hu', subject: 'Megrendelési szám: #12247833' },
  { id: 'commerce-v2-16', expectedKind: 'commerce', sender: 'noreply@dpd.hu', subject: 'Értesítés 16380124260518 küldemény előkészítéséről' },
  { id: 'commerce-v2-17', expectedKind: 'commerce', sender: 'noreply@gls-hungary.com', subject: 'Dinamikus csomagkövetés - GLS' },
  { id: 'commerce-v2-18', expectedKind: 'commerce', sender: 'noreply@gls-hungary.com', subject: 'GLS 3412614699 mai kézbesítése / GLS 3412614699 delivery today' },
  { id: 'commerce-v2-19', expectedKind: 'commerce', sender: 'noreply@sinsay.com', subject: 'A 15710474710 számú rendelésed készen áll a szállításra.' },
  { id: 'commerce-v2-20', expectedKind: 'commerce', sender: 'noreply@sinsay.com', subject: 'A 15710474710 számú rendelésedet csomagolják.' },
  { id: 'commerce-v2-21', expectedKind: 'commerce', sender: 'noreply@gls-hungary.com', subject: 'GLS csomag információ / GLS parcel information' },
  { id: 'commerce-v2-22', expectedKind: 'commerce', sender: 'arsuna@arsuna.hu', subject: 'Ars Una számlája érkezett' },
  { id: 'commerce-v2-23', expectedKind: 'commerce', sender: 'info@jatekbolt.hu', subject: 'Megrendelési szám: 12247833' },
  { id: 'commerce-v2-24', expectedKind: 'commerce', sender: 'webshop@arsuna.hu', subject: 'Ars Una Studio Kft.: #192132 számú rendelése létrejött' },
  { id: 'commerce-v2-25', expectedKind: 'commerce', sender: 'donotreply@mcdonalds.com', subject: 'Fizetés megerősítése' },
  { id: 'commerce-v2-26', expectedKind: 'commerce', sender: 'donotreply@mcdonalds.com', subject: 'Fizetés megerősítése' },

  { id: 'noise-v2-01', expectedKind: 'noise', sender: 'message@message.sinsay.com', subject: 'Teljes iskolai öltözet 🔔' },
  { id: 'noise-v2-02', expectedKind: 'noise', sender: 'newsletter@hirlevel.jatekbolt.hu', subject: '⏰Két hét múlva kezdődik a suli⏰' },
  { id: 'noise-v2-03', expectedKind: 'noise', sender: 'message@ma.sinsay.com', subject: 'Mit szeretsz a legjobban a Sinsay-ben?' },
  { id: 'noise-v2-04', expectedKind: 'noise', sender: 'message@message.sinsay.com', subject: '-20% ☀️ Nyári Ajánlatok' },
  { id: 'noise-v2-05', expectedKind: 'noise', sender: 'newsletter@hirlevel.jatekbolt.hu', subject: 'ÁFA-mentes napok meghosszabbítva! Vásárolj be sulikezdésre!' },
  { id: 'noise-v2-06', expectedKind: 'noise', sender: 'info@jatekbolt.hu', subject: 'Kérjük, értékeld a megvásárolt termékeket!' },
  { id: 'noise-v2-07', expectedKind: 'noise', sender: 'message@message.sinsay.com', subject: '🧡 -2 900 HUF 🧡' },
  { id: 'noise-v2-08', expectedKind: 'noise', sender: 'ertekesites@expressone.hu', subject: 'Tájékoztatás ÁSZF változásról / Changes to our General Terms and Conditions' },
  { id: 'noise-v2-09', expectedKind: 'noise', sender: 'message@ma.sinsay.com', subject: 'Sinsay - a legújabb trendek az egész családnak és otthonodnak 💖' },
  { id: 'noise-v2-10', expectedKind: 'noise', sender: 'newsletter@hirlevel.jatekbolt.hu', subject: 'ÁFA-mentes napok, kültéri játékok, Muffik és a hét SUP ajánlata!' },
  { id: 'noise-v2-11', expectedKind: 'noise', sender: 'message@message.sinsay.com', subject: 'Vissza az iskolába a Disney-vel! 🏰' },
  { id: 'noise-v2-12', expectedKind: 'noise', sender: 'velemeny@adat.dpd.hu', subject: 'Ajánlaná a DPD szolgáltatásait másoknak?' },
  { id: 'noise-v2-13', expectedKind: 'noise', sender: 'message@message.sinsay.com', subject: 'Ingyenes szállítás MINDENRE 🚚' },
  { id: 'noise-v2-14', expectedKind: 'noise', sender: 'noreply@gls-hungary.com', subject: 'GLS elégedettségi kérdőív' },
  { id: 'noise-v2-15', expectedKind: 'noise', sender: 'webshop@arsuna.hu', subject: 'Ars Una Studio Kft.: Erősítse meg a feliratkozást' },
  { id: 'noise-v2-16', expectedKind: 'noise', sender: 'webshop@arsuna.hu', subject: 'Ars Una Studio Kft.: Értesítés új felhasználói profil létrehozásáról' },
  { id: 'noise-v2-17', expectedKind: 'noise', sender: 'info@expressone.hu', subject: 'Kézbesítéssel kapcsolatos információk' },
  { id: 'noise-v2-18', expectedKind: 'noise', sender: 'info@expressone.hu', subject: 'Nézd meg, mi történt velünk júliusban!' },
];

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function normalizeFixtureText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function messageFixtureKey(sender: string, subject: string): string {
  return `${normalizeFixtureText(sender)}\n${normalizeFixtureText(subject)}`;
}

function primarySender(email: NormalizedEmail): string {
  return email.from[0]?.email?.trim().toLowerCase() ?? '';
}

function detectedCommerce(classification: string | null): boolean {
  return Boolean(classification && classification !== 'other' && !classification.startsWith('security_'));
}

function auditNormalizedEmail(id: string, expectedKind: ExpectedKind, email: NormalizedEmail) {
  const plan = planNormalizedInboundEmail({ email });
  const commerce = detectedCommerce(plan.classification);
  const verdict = expectedKind === 'commerce'
    ? (commerce ? 'true_positive' : 'false_negative')
    : (commerce ? 'false_positive' : 'true_negative');
  return {
    id,
    expectedKind,
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

function resultSummary(rows: Array<Record<string, unknown>>) {
  const count = (value: string) => rows.filter((row) => row.verdict === value).length;
  const tp = count('true_positive');
  const fn = count('false_negative');
  const fp = count('false_positive');
  const tn = count('true_negative');
  return {
    truePositive: tp,
    falseNegative: fn,
    falsePositive: fp,
    trueNegative: tn,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
  };
}

async function runAuditV2(userId: string) {
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
  const fixtureQueues = new Map<string, CuratedFixture[]>();
  for (const fixture of CURATED_FIXTURES_V2) {
    const key = messageFixtureKey(fixture.sender, fixture.subject);
    const queue = fixtureQueues.get(key) ?? [];
    queue.push(fixture);
    fixtureQueues.set(key, queue);
  }

  const matchedIds = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let cursor: string | undefined;

  do {
    const page = await provider.searchMessages({
      query: 'newer_than:60d -in:spam -in:trash',
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    for (const email of page.messages) {
      scanned += 1;
      const key = messageFixtureKey(primarySender(email), email.subject ?? '');
      const queue = fixtureQueues.get(key);
      const fixture = queue?.find((candidate) => !matchedIds.has(candidate.id));
      if (fixture) {
        matchedIds.add(fixture.id);
        rows.push(auditNormalizedEmail(fixture.id, fixture.expectedKind, email));
      }
      if (matchedIds.size === CURATED_FIXTURES_V2.length || scanned >= MAX_SCAN) break;
    }
    if (matchedIds.size === CURATED_FIXTURES_V2.length || scanned >= MAX_SCAN) break;
    cursor = page.nextCursor;
  } while (cursor);

  const missing = CURATED_FIXTURES_V2.filter((fixture) => !matchedIds.has(fixture.id));
  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-curated-mailbox-v2-blind',
    productionWrites: 0,
    aiCalls: 0,
    expectedTotal: CURATED_FIXTURES_V2.length,
    matchedTotal: rows.length,
    coverage: rows.length / CURATED_FIXTURES_V2.length,
    scanned,
    summary: resultSummary(rows),
    missing,
    rows,
  };
}

function auditPageHtml(): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Blind Audit v2</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1080px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:42px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:28px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.row{display:grid;grid-template-columns:120px 1fr 90px;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Blind Audit v2</strong><a class="back" href="/audit">v1 audit</a></div><section class="card"><div class="eyebrow">BLIND SET · SHADOW · 0 WRITE · 0 AI</div><h1>44 új email</h1><p>26 commerce + 18 nehéz noise. Ez a készlet a motor módosítása után lett kiválasztva, ezért az első futás valódi általánosítási teszt.</p><button id="run">Audit v2 futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},bad=(s.falseNegative||0)+(s.falsePositive||0),rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join(''),missing=(d.missing||[]).map(r=>'<div class="row"><span class="pill bad">missing</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(d.matchedTotal)+'/'+esc(d.expectedTotal)+'</strong><span>megtalált</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>hiba</span></div></div><p class="muted">TP '+esc(s.truePositive)+' · FN '+esc(s.falseNegative)+' · FP '+esc(s.falsePositive)+' · TN '+esc(s.trueNegative)+' · Scanned '+esc(d.scanned)+'</p>'+rows+missing}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Audit fut…';try{const res=await fetch('/api/audit/curated-mailbox-v2',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerCuratedMailboxAuditV2(app: FastifyInstance) {
  app.get('/audit-v2', async (_request, reply) => reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(auditPageHtml()));
  app.post('/api/audit/curated-mailbox-v2', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const result = await runAuditV2(user.id);
      request.log.info({ userId: user.id, expectedTotal: result.expectedTotal, matchedTotal: result.matchedTotal, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Blind curated mailbox audit v2 completed');
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'curated_audit_v2_failed';
      request.log.error({ code }, 'Blind curated mailbox audit v2 failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
