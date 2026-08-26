import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { normalizeForwardedEml } from '../email/mailgun-inbound.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const CURATED_PAGE_SIZE = 100;
const CURATED_MAX_SCAN = 1_000;

type ExpectedKind = 'commerce' | 'noise' | 'unknown';

interface AuditItem {
  id?: string;
  filename?: string;
  expectedKind?: ExpectedKind;
  rawMimeBase64: string;
}

interface CuratedFixture {
  id: string;
  expectedKind: Exclude<ExpectedKind, 'unknown'>;
  sender: string;
  subject: string;
}

const CURATED_FIXTURES_V1: CuratedFixture[] = [
  { id: 'commerce-01', expectedKind: 'commerce', sender: 'info@service.gymbeam.hu', subject: 'Kozma a számlád elkészült! - 3010410391' },
  { id: 'commerce-02', expectedKind: 'commerce', sender: 'ertesites@expressone.hu', subject: 'Küldemény kézbesítve – kérdőív' },
  { id: 'commerce-03', expectedKind: 'commerce', sender: 'ertesites@expressone.hu', subject: 'Csomag kézbesítés ma – ETA és módosítás' },
  { id: 'commerce-04', expectedKind: 'commerce', sender: 'ertesites@expressone.hu', subject: 'Küldemény feldolgozása megkezdődött' },
  { id: 'commerce-05', expectedKind: 'commerce', sender: 'info@service.gymbeam.hu', subject: 'Kozma, a megrendelésed úton van!' },
  { id: 'commerce-06', expectedKind: 'commerce', sender: 'info@service.gymbeam.hu', subject: 'Kozma, a rendelésed feldolgozás alatt van.' },
  { id: 'commerce-07', expectedKind: 'commerce', sender: 'googleplay-noreply@google.com', subject: 'Google Play-rendelés (2026. aug. 16.) nyugtája' },
  { id: 'commerce-08', expectedKind: 'commerce', sender: 'info@limone.hu', subject: 'Parfümök online a Limone.hu-n - Automata megrendelés visszaigazolás - 98691-106627' },
  { id: 'commerce-09', expectedKind: 'commerce', sender: 'info@fnp.hu', subject: 'FNP Products - Sikeres rendelés megerősítése 🥳' },
  { id: 'commerce-10', expectedKind: 'commerce', sender: 'gyerekjatekbolt@gyerekjatekbolt.com', subject: 'Gyerekjatekbolt.com – a(z) 536066. számú rendelés állapota megváltozott' },
  { id: 'commerce-11', expectedKind: 'commerce', sender: 'ertesitesek@allegro.hu', subject: 'A futár ma érkezik. A következő termékeket tartalmazó csomagot szállítja ki: 3 db-os kulacs szett motivációs edzéshez 2000ml+900ml+300ml' },
  { id: 'commerce-12', expectedKind: 'commerce', sender: 'ertesitesek@allegromail.com', subject: 'Értesítés 13169408547018 HappyBox24 küldemény mai kézbesítéséről' },
  { id: 'commerce-13', expectedKind: 'commerce', sender: 'noreply@gls-hungary.com', subject: 'GLS 3412842135 mai kézbesítése / GLS 3412842135 delivery today' },
  { id: 'commerce-14', expectedKind: 'commerce', sender: 'gyerekjatekbolt@gyerekjatekbolt.com', subject: 'Gyerekjatekbolt.com - a(z) 536066. számú rendelés állapota megváltozott' },
  { id: 'commerce-15', expectedKind: 'commerce', sender: 'gyerekjatekbolt@gyerekjatekbolt.com', subject: 'Gyerekjatekbolt.com – a(z) 536066. számú rendelés állapota megváltozott' },
  { id: 'commerce-16', expectedKind: 'commerce', sender: 'gyerekjatekbolt@gyerekjatekbolt.com', subject: 'Gyerekjatekbolt.com – Rendelés 536066 – 14.960 Ft' },
  { id: 'commerce-17', expectedKind: 'commerce', sender: 'info@jatekbolt.hu', subject: 'Elkészült a rendelésedhez tartozó számla' },
  { id: 'commerce-18', expectedKind: 'commerce', sender: 'noreply@sinsay.com', subject: 'A 15710474710 rendelés megerősítése.' },
  { id: 'commerce-19', expectedKind: 'commerce', sender: 'gyerekjatekbolt@gyerekjatekbolt.com', subject: 'Gyerekjatekbolt.com – Rendelés 535574 – 14.660 Ft' },
  { id: 'commerce-20', expectedKind: 'commerce', sender: 'szidibox@gmail.com', subject: 'Szidibox Karton Kft. Webáruház - Rendelés SO-2024-30411' },
  { id: 'noise-01', expectedKind: 'noise', sender: 'no-reply@render.com', subject: 'build failed for buyflow-v3-api-dev' },
  { id: 'noise-02', expectedKind: 'noise', sender: 'store+85580841304@g.shopifyemail.com', subject: '🎀 FINAL SUMMER SALE: akár –35% VASÁRNAP ÉJFÉLIG!🎀' },
  { id: 'noise-03', expectedKind: 'noise', sender: 'meki@m.mcdonalds.hu', subject: 'Hoztunk egy hűsítő kedvezményt ❄️' },
  { id: 'noise-04', expectedKind: 'noise', sender: 'clients@eany.io', subject: 'Updated processing fees by country & Daily Exclusive Deals 🚀' },
  { id: 'noise-05', expectedKind: 'noise', sender: 'info@join.netflix.com', subject: 'Seal Team 6. évad – már megérkezett' },
  { id: 'noise-06', expectedKind: 'noise', sender: 'kfc@kfc.hu', subject: 'Augusztus 20-án is KFC? Mutatjuk, hol! 🍗🎆' },
  { id: 'noise-07', expectedKind: 'noise', sender: 'megbizhatobolt@arukereso.hu', subject: 'Elégedett volt Kartonshop.hu webáruházban történt vásárlással?' },
  { id: 'noise-08', expectedKind: 'noise', sender: 'ea@e.ea.com', subject: 'ALL. SYSTEMS. GO.' },
  { id: 'noise-09', expectedKind: 'noise', sender: 'team@mobbin.com', subject: 'Save and share on Mobbin' },
  { id: 'noise-10', expectedKind: 'noise', sender: 'newsletter@javoli.hu', subject: '⚽ A futball két óriása tarol az iskolakezdésben!' },
  { id: 'noise-11', expectedKind: 'noise', sender: 'info@xxlfoto.hu', subject: '📸 200 db 10x15 cm-es Prémium Fénykép 11800 Ft' },
  { id: 'noise-12', expectedKind: 'noise', sender: 'info@message.cropp.com', subject: 'SZETTEK KÜLÖNCÖKNEK 👖' },
];

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function detectedCommerce(classification: string | null): boolean {
  return Boolean(classification && classification !== 'other' && !classification.startsWith('security_'));
}

function extractionSnapshot(result: Record<string, unknown>) {
  const products = Array.isArray(result.products)
    ? result.products.slice(0, 50).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const name = stringOrNull(row.name);
      return name ? [{
        name,
        quantity: numberOrNull(row.quantity),
        unitPrice: numberOrNull(row.unit_price),
        totalPrice: numberOrNull(row.total_price),
        currency: stringOrNull(row.currency),
      }] : [];
    })
    : [];

  return {
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    total: numberOrNull(result.total),
    currency: stringOrNull(result.currency),
    shippingAmount: numberOrNull(result.shipping_amount),
    codAmount: numberOrNull(result.cod_amount),
    codCurrency: stringOrNull(result.cod_currency),
    carrier: stringOrNull(result.carrier),
    paymentStatus: stringOrNull(result.payment_status),
    paymentMethod: stringOrNull(result.payment_method),
    shippingMethod: stringOrNull(result.shipping_method),
    trackingNumber: stringOrNull(result.tracking_number),
    products,
  };
}

function auditNormalizedEmail(id: string, expected: ExpectedKind, email: NormalizedEmail) {
  const plan = planNormalizedInboundEmail({ email });
  const commerce = detectedCommerce(plan.classification);
  const verdict = expected === 'commerce'
    ? (commerce ? 'true_positive' : 'false_negative')
    : expected === 'noise'
      ? (commerce ? 'false_positive' : 'true_negative')
      : 'unscored';

  return {
    id,
    expectedKind: expected,
    sender: email.from[0]?.email ?? null,
    subject: email.subject ?? null,
    receivedAt: email.receivedAt,
    classification: plan.classification,
    parserVersion: plan.parserVersion,
    recognitionStatus: plan.status,
    validationStatus: plan.validationStatus,
    detectedCommerce: commerce,
    verdict,
    extraction: extractionSnapshot(plan.structuredResult),
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
    unscored: count('unscored'),
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
  };
}

export async function auditRawMimeBatch(messages: AuditItem[]) {
  if (messages.length === 0) throw new Error('empty_batch');
  if (messages.length > MAX_MESSAGES) throw new Error('too_many_messages');

  let totalBytes = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index]!;
    const raw = Buffer.from(item.rawMimeBase64 ?? '', 'base64');
    if (raw.length === 0) throw new Error(`empty_raw_mime:${index}`);
    if (raw.length > MAX_MESSAGE_BYTES) throw new Error(`message_too_large:${index}`);
    totalBytes += raw.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('batch_too_large');

    const id = stringOrNull(item.id) ?? `message-${index + 1}`;
    const expected: ExpectedKind = item.expectedKind === 'commerce' || item.expectedKind === 'noise'
      ? item.expectedKind
      : 'unknown';

    try {
      const email = await normalizeForwardedEml(raw, `audit-${id}`);
      rows.push(auditNormalizedEmail(id, expected, email));
    } catch (error) {
      rows.push({
        id,
        filename: stringOrNull(item.filename),
        expectedKind: expected,
        error: error instanceof Error ? error.message : 'parse_failed',
        detectedCommerce: false,
        verdict: expected === 'commerce' ? 'false_negative' : expected === 'noise' ? 'true_negative' : 'unscored',
        productionWrites: 0,
        aiCalls: 0,
      });
    }
  }

  return {
    ok: true,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    total: rows.length,
    bytesProcessed: totalBytes,
    summary: resultSummary(rows),
    rows,
  };
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

async function runCuratedMailboxAudit(userId: string) {
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

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });

  const fixtureQueues = new Map<string, CuratedFixture[]>();
  for (const fixture of CURATED_FIXTURES_V1) {
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
      query: 'newer_than:30d -in:spam -in:trash',
      limit: CURATED_PAGE_SIZE,
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
      if (matchedIds.size === CURATED_FIXTURES_V1.length || scanned >= CURATED_MAX_SCAN) break;
    }

    if (matchedIds.size === CURATED_FIXTURES_V1.length || scanned >= CURATED_MAX_SCAN) break;
    cursor = page.nextCursor;
  } while (cursor);

  const missing = CURATED_FIXTURES_V1.filter((fixture) => !matchedIds.has(fixture.id)).map((fixture) => ({
    id: fixture.id,
    expectedKind: fixture.expectedKind,
    sender: fixture.sender,
    subject: fixture.subject,
  }));

  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-curated-mailbox-v1',
    productionWrites: 0,
    aiCalls: 0,
    expectedTotal: CURATED_FIXTURES_V1.length,
    matchedTotal: rows.length,
    coverage: rows.length / CURATED_FIXTURES_V1.length,
    scanned,
    summary: resultSummary(rows),
    missing,
    rows,
  };
}

function auditPageHtml(): string {
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>BuyFlow Motor Audit</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 10%,#35206d55,transparent 34%),radial-gradient(circle at 85% 25%,#c52b8050,transparent 30%),#071020}main{width:min(1040px,calc(100% - 28px));margin:0 auto;padding:34px 0 70px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}.brand{font-weight:800;font-size:20px}.brand span{color:#d86cff}.back{color:#d8ddff;text-decoration:none;border:1px solid #ffffff22;border-radius:14px;padding:10px 14px;background:#ffffff0c}.card{background:#0d1830d9;border:1px solid #ffffff18;border-radius:24px;padding:22px;box-shadow:0 18px 60px #0005;margin-bottom:18px}h1{font-size:clamp(28px,6vw,48px);margin:8px 0 10px}p{color:#aeb9d7;line-height:1.55}.eyebrow{font-size:12px;letter-spacing:.14em;font-weight:800;color:#d86cff}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}button{border:0;border-radius:15px;padding:13px 18px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#764cff,#e84f9b);color:white}button:disabled{opacity:.55;cursor:wait}.muted{font-size:13px;color:#8190b6}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.metric{background:#ffffff08;border:1px solid #ffffff14;border-radius:18px;padding:16px}.metric strong{display:block;font-size:28px}.metric span{font-size:12px;color:#9eacd0}.good{color:#62dfaa}.bad{color:#ff7d9d}.warn{color:#ffd479}.rows{display:grid;gap:10px}.row{padding:14px 16px;border:1px solid #ffffff12;background:#ffffff06;border-radius:16px;display:grid;grid-template-columns:110px 1fr auto;gap:12px;align-items:center}.pill{font-size:11px;font-weight:800;padding:6px 9px;border-radius:999px;background:#ffffff10}.subject{font-weight:700}.meta{font-size:12px;color:#8f9ec3;margin-top:4px;word-break:break-all}pre{white-space:pre-wrap;word-break:break-word;color:#b9c5e6;font-size:12px}@media(max-width:720px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}.top{align-items:flex-start}.hide-mobile{display:none}}
</style>
</head>
<body><main>
<div class="top"><div class="brand">Buy<span>Flow</span> · Motor Audit</div><a class="back" href="/app/">Vissza az apphoz</a></div>
<section class="card"><div class="eyebrow">SHADOW · 0 PRODUCTION WRITE · 0 AI CALL</div><h1>32 valódi email audit</h1><p>A Gmailben kiválogatott 20 commerce + 12 noise referenciaüzenet Nylason keresztül kerül beolvasásra, majd ugyanaz a determinisztikus BuyFlow motor fut rajtuk. Ez csak átmeneti tesztforrás; az éles inbound út továbbra is Mailgun/BuyFlow email lehet.</p><div class="actions"><button id="run">Audit futtatása</button><span id="status" class="muted">Bejelentkezés ellenőrzése…</span></div></section>
<section id="results" class="card" hidden></section>
</main>
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');
const run=document.querySelector('#run');const status=document.querySelector('#status');const results=document.querySelector('#results');
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pct(v){return typeof v==='number'?(v*100).toFixed(1)+'%':'—';}
function render(data){const s=data.summary||{};const bad=(s.falseNegative||0)+(s.falsePositive||0);const rows=(data.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><div class="subject">'+esc(r.subject)+'</div><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');const missing=(data.missing||[]).map(r=>'<div class="row"><span class="pill warn">missing</span><div><div class="subject">'+esc(r.subject)+'</div><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(data.matchedTotal)+'/'+esc(data.expectedTotal)+'</strong><span>megtalált minta</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>felismerési hiba</span></div></div><p class="muted">True positive: '+esc(s.truePositive)+' · False negative: '+esc(s.falseNegative)+' · False positive: '+esc(s.falsePositive)+' · True negative: '+esc(s.trueNegative)+' · Scanned: '+esc(data.scanned)+'</p><div class="rows">'+rows+missing+'</div>';} 
async function session(){const {data}=await supabase.auth.getSession();return data.session;}
const initial=await session();status.textContent=initial?'Kész. A teszt csak olvas.':'Nincs aktív BuyFlow bejelentkezés. Nyisd meg az appot, lépj be, majd gyere vissza ide.';run.disabled=!initial;
run.addEventListener('click',async()=>{const s=await session();if(!s){status.textContent='A munkamenet lejárt. Jelentkezz be újra az appban.';run.disabled=true;return;}run.disabled=true;status.textContent='Audit fut… ez néhány másodperc lehet.';results.hidden=true;try{const res=await fetch('/api/audit/curated-mailbox-v1',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}});const data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. Production write: 0 · AI call: 0.';}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e));}finally{run.disabled=false;}});
</script></body></html>`;
}

export async function registerRawEmailAuditRoutes(app: FastifyInstance) {
  app.get('/audit', async (_request, reply) => reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'same-origin')
    .send(auditPageHtml()));

  app.post<{ Body: { messages?: AuditItem[] } }>(
    '/api/audit/eml-batch',
    { bodyLimit: 35 * 1024 * 1024 },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
      try {
        const result = await auditRawMimeBatch(messages);
        request.log.info({ userId: user.id, total: result.total, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Raw MIME batch audit completed');
        return reply.code(200).send(result);
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: error instanceof Error ? error.message : 'invalid_audit_batch',
        });
      }
    },
  );

  app.post('/api/audit/curated-mailbox-v1', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    try {
      const result = await runCuratedMailboxAudit(user.id);
      request.log.info({
        userId: user.id,
        expectedTotal: result.expectedTotal,
        matchedTotal: result.matchedTotal,
        scanned: result.scanned,
        ...result.summary,
        productionWrites: 0,
        aiCalls: 0,
      }, 'Curated real-mailbox deterministic audit completed');
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Curated mailbox audit failed');
      const code = error instanceof Error ? error.message : 'curated_audit_failed';
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}