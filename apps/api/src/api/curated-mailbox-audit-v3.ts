import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 2_500;

type ExpectedKind = 'commerce' | 'noise';

interface CuratedFixture {
  id: string;
  expectedKind: ExpectedKind;
  sender: string;
  subject: string;
}

// Frozen before the first v3 run. These messages were selected and ground-truthed
// without changing the detector from the generic-commerce-v3-shadow state.
const COMMERCE_V3 = [
  ['support@replit.com', '[Replit] Re: Refund request #503830'],
  ['invoice+statements+acct_15YpNsJAmnYVOvfn@stripe.com', 'Your refund from Replit #3401-6095'],
  ['ertesites@expressone.hu', 'Küldemény kézbesítve – kérdőív'],
  ['googleplay-noreply@google.com', 'Google Play-rendelés (2026. aug. 9.) nyugtája'],
  ['noreply@gls-hungary.com', 'GLS csomag információ / GLS parcel information'],
  ['gyerekjatekbolt@gyerekjatekbolt.com', 'Sikeres bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!'],
  ['gyerekjatekbolt@gyerekjatekbolt.com', 'Gyerekjatekbolt.com – a(z) 535574. számú rendelés állapota megváltozott'],
  ['noreply@dpd.hu', 'Értesítés 16380143879559 küldemény előkészítéséről'],
  ['noreply@dpd.hu', 'Értesítés 16380124260338 küldemény előkészítéséről'],
  ['webshop@arsuna.hu', 'Ars Una Studio Kft.: #192132 számú rendelése szállítás alatt'],
  ['ertesitesek@allegromail.com', 'Értesítés 13169408547018 nemzetközi küldemény feladásáról'],
  ['gyerekjatekbolt@gyerekjatekbolt.com', 'Bankkártyás fizetés link'],
  ['gyerekjatekbolt@gyerekjatekbolt.com', 'Sikertelen bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!'],
  ['noreply@barion.com', 'Sikeres fizetés'],
  ['donotreply@mcdonalds.com', 'Fizetés megerősítése'],
  ['googleplay-noreply@google.com', 'Google Play-rendelés (2026. júl. 16.) nyugtája'],
  ['ertesites@expressone.hu', 'Késik a kézbesítés – új ETA: 5 perc'],
  ['barion@barion.com', 'Sikeres fizetés'],
  ['noreply@gls-hungary.com', 'Értesítés a 3408405568 számú csomag GLS Automatába helyezéséről'],
  ['info@limone.hu', 'Parfümök online a Limone.hu-n - Automata megrendelés visszaigazolás - 98691-106407'],
  ['noreply@gls-hungary.com', 'Utánvétes fizetés visszaigazolás'],
  ['noreply@gls-hungary.com', 'Utánvétes fizetés visszaigazolás'],
  ['noreply@gls-hungary.com', 'Értesítés a 3408261506 számú csomag GLS Automatába helyezéséről'],
  ['noreply@gls-hungary.com', 'Értesítés a 3408294126 számú csomag GLS Automatába helyezéséről'],
  ['googleplay-noreply@google.com', 'Google Play-rendelés (2026. júl. 9.) nyugtája'],
  ['ertesites@expressone.hu', 'Küldemény feldolgozása megkezdődött'],
  ['info@kavegepbolt.hu', 'Tájékoztatás a megrendelés állapotáról'],
  ['info@kavegepbolt.hu', 'Kávégép Bolt – Megrendelés visszaigazolás - 9160-675123'],
  ['webszamla@playersroom.hu', 'E-számla érkezett ( E2026/49/0080/14707 )'],
  ['noreply@dorko.hu', 'Dorko: rendelés elküldve'],
  ['donotreply@mcdonalds.com', 'Fizetés megerősítése'],
  ['noreply@dorko.hu', 'Dorko: DK2001799 rendelés/foglalás visszaigazolás'],
  ['info@sport8.hu', 'Forproshop – a(z) 21690. számú rendelés állapota megváltozott'],
  ['sport8@szamlazz.hu', 'Értesítő: Számla érkezett – SPORT8 HUNGARY Kft.'],
  ['info@sport8.hu', 'Forproshop – a(z) 21690. számú rendelés állapota megváltozott'],
  ['info@sport8.hu', 'Rendelés visszaigazolás - Forproshop - 21690'],
  ['googleplay-noreply@google.com', 'Google Play-rendelés (2026. jún. 16.) nyugtája'],
  ['hello@marketa.hu', '✅ Marketa.hu - 1140165 rendelés - Jó hír! Elkezdtük rendelésed összekészítését! - Megrendelésedet elfogadtuk'],
  ['szidibox@gmail.com', 'Szidibox Karton Kft. Webáruház - Rendelés SO-2024-29019'],
  ['hello@marketa.hu', '❗️ Marketa.hu - 1140165 rendelés - Fontos Információ'],
  ['noreply@simplepay.hu', 'SimplePay - Sikeres fizetés - https://www.netfone.hu'],
  ['googleplay-noreply@google.com', 'Google Play-rendelés (2026. máj. 24.) nyugtája'],
  ['online@sportvision.hu', 'Információ a megrendelés állapotáról'],
  ['online@sportvision.hu', 'Információ a megrendelés állapotáról'],
  ['online@sportvision.hu', 'Megrendelés visszaigazolása #96048'],
  ['barion@barion.com', 'Sikeres fizetés'],
  ['segito@alza.hu', 'Köszönjük a megrendelést, már csak a fizetés van hátra / 594687258 sz. megr.'],
  ['info@nint.hu', 'Rendelés (#18946) visszaigazolva'],
  ['info@nint.hu', 'Rendelés (#18944) visszaigazolva'],
  ['info@ipon.hu', 'Számla 2026/060906'],
] as const;

const NOISE_V3 = [
  ['meki@m.mcdonalds.hu', 'Még tart a nyári lendület? ️'],
  ['info@heroclothing.eu', 'A V-Neckek újra teljesen készleten vannak 🤩'],
  ['newsletter@javoli.hu', 'K-POP Demon Hunters – az iskolakezdés új kedvence!'],
  ['kfc@kfc.hu', 'Dos Tacos? Ne maradj le, 2 Taco helyben fogyasztva csak 1290 Ft! ! 🌮🌮'],
  ['news@exisport.hu', 'Szia, mire vársz még Gábor?'],
  ['report@notify.aftershipmail.com', 'Your AfterShip Tracking weekly report (Aug 10 - Aug 16)'],
  ['akcio@akcio.lampak.hu', 'Feloldottuk neked a titkos kategóriát extra 25% kedvezménnyel!'],
  ['info@message.cropp.com', 'Megérkeztek az új termékek: cipők, táskák, hátizsákok 👀'],
  ['info@es.lampandlight.eu', '15% EXTRA kedvezmény?'],
  ['info@heroclothing.eu', 'Mennyibe kerül valójában a HERO Boxer egy-egy hordása? 🪎'],
  ['tips@nylas.com', 'Architecture decisions worth making before you go too far'],
  ['send@norabeauty.com', '2 szérum, 2 sminkrutin, 1 ragyogó hatás 💜✨'],
  ['promotion@zentrada.hu', 'Praktikus őszi választékok az otthon és konyha számára'],
  ['info@xxlfoto.hu', '🎁📸 Prémium fénykép akció választható ajándékkal!'],
  ['info@myenergy.eon.hu', 'Új okosklíma bevezető áron – 99 900 Ft kezdőrészlettől'],
  ['info@galaxy.hu', '🎁 Fantasztikus csomagajánlatok a Samsung Experience Store-okban! - Spórolj akár 40 000 Forintot'],
  ['info@es.lampandlight.eu', 'Még 5 nap: további 15% kedvezmény'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Megbízási csomag lezárása - 518124715202608130947427820 - Címzett: KOZMA GÁBORNÉ - 2026.08.13. 09:47:12)'],
  ['info@heroclothing.eu', 'A 15% kedvezmény a HERO Pólóingekre ma este véget ér'],
  ['meki@m.mcdonalds.hu', 'Még mindig tombol a nyár! ☀️'],
  ['zamyra@zamyra.hu', '🍂Új ŐSZI Kollekció'],
  ['megbizhatobolt@arukereso.hu', 'Elégedett volt Gyerekjatekbolt.com játék webáruház webáruházban történt vásárlással?'],
  ['info@xxlfoto.hu', '📸 100 db 10x15 cm-es prémium fénykép 6000 Ft!'],
  ['message@news2.zalando.com', 'Minden, ami sport - most 20% kedvezménnyel'],
  ['promotion@zentrada.hu', 'Őszi akciók helyhez kötött üzletek számára: szezonális highlight termékek és erős kiegészítő kínálatok'],
  ['info@heroclothing.eu', 'Ez ÓRIÁSI különbséget jelent'],
  ['info@es.lampandlight.eu', 'Utolsó hét: 15%-os további kedvezmény 42.650Ft feletti vásárlás esetén'],
  ['aftership@email.aftership.com', 'Welcome to AfterShip Tracking!'],
  ['szia@awgifts.hu', '🌿 Utolsó esély: 30% kedvezmény a nepáli kenderkollekcióra – csak ma éjfélig!'],
  ['info@heroclothing.eu', '20,000+ men can’t be wrong 💪'],
  ['reviews@trustmate.io', '💌 Oszd meg a véleményed az általad rendelt termékekről!'],
  ['info@heroclothing.eu', 'Ismerd meg az új HERO pólóingeket 👕'],
  ['noreply@hirlevel.vectraline.hu', '🛒 Friss heti ajánlatok érkeztek!'],
  ['hirlevel@okosgazdi.hu', '🐈 Négy íz egy kartonban cicád változatos étkezéséért'],
  ['akcio@akcio.lampak.hu', 'Ma midnight lejár az extra 25% kedvezmény a kijelölt 30 modellre!'],
  ['info@es.lampandlight.eu', '15% kedvezmény 42.650 Ft feletti vásárlás esetén'],
  ['info@message.cropp.com', 'A szezon kötelező darabjai 🤩'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta - 518124715202608081915121139 - Címzett: KOZMA GÁBORNÉ - 2026.08.08. 19:15:50)'],
  ['info@heroclothing.eu', 'A belt for every occasion 🙌🏼'],
  ['info@xxlfoto.hu', '☀️ 2000 Ft értékű kuponod érkezett!'],
  ['news@letter.alza.hu', 'Itt az új Galaxy Z Fold széria.'],
  ['info@heroclothing.eu', 'Boxers you’ll never want to take off'],
  ['info@oxygenihair.com', 'Eljött a nyári pihenés ideje☀️ – fontos információ rendeléseidhez'],
  ['akcio@akcio.lampak.hu', 'Lámpák mega vására. Csak vasárnapig -25% a kuponkóddal!'],
  ['ugyfelszolgalat@dijnet.hu', 'Díjnet számla érkezett'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta - 518124715202607231131437854 - Címzett: KOZMA GÁBORNÉ - 2026.07.23. 11:31:57)'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta - 518124715202607161214989091 - Címzett: KOZMA GÁBORNÉ - 2026.07.16. 12:14:35)'],
  ['ugyfelszolgalat@dijnet.hu', 'Díjnet számla érkezett'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta - 518124715202605201928554171 - Címzett: KOZMA GÁBORNÉ - 2026.05.20. 19:28:13)'],
  ['ertesites@tarhely.gov.hu', 'Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta - 518124715202605201043648731 - Címzett: KOZMA GÁBORNÉ - 2026.05.20. 10:43:15)'],
] as const;

const CURATED_FIXTURES_V3: CuratedFixture[] = [
  ...COMMERCE_V3.map(([sender, subject], index) => ({
    id: `commerce-v3-${String(index + 1).padStart(2, '0')}`,
    expectedKind: 'commerce' as const,
    sender,
    subject,
  })),
  ...NOISE_V3.map(([sender, subject], index) => ({
    id: `noise-v3-${String(index + 1).padStart(2, '0')}`,
    expectedKind: 'noise' as const,
    sender,
    subject,
  })),
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
    .replace(/[\u200B-\u200D\uFE0F\uFEFF]/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function fixtureKey(sender: string, subject: string): string {
  return `${normalizeFixtureText(sender)}\n${normalizeFixtureText(subject)}`;
}

function primarySender(email: NormalizedEmail): string {
  return email.from[0]?.email?.trim().toLowerCase() ?? '';
}

function detectedCommerce(classification: string | null): boolean {
  return Boolean(classification && classification !== 'other' && !classification.startsWith('security_'));
}

function auditEmail(fixture: CuratedFixture, email: NormalizedEmail) {
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
  const count = (verdict: string) => rows.filter((row) => row.verdict === verdict).length;
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

async function runAuditV3(userId: string) {
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
  const queues = new Map<string, CuratedFixture[]>();
  for (const fixture of CURATED_FIXTURES_V3) {
    const key = fixtureKey(fixture.sender, fixture.subject);
    const queue = queues.get(key) ?? [];
    queue.push(fixture);
    queues.set(key, queue);
  }

  const matched = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let cursor: string | undefined;

  do {
    const page = await provider.searchMessages({
      query: 'newer_than:180d -in:spam -in:trash',
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    for (const email of page.messages) {
      scanned += 1;
      const queue = queues.get(fixtureKey(primarySender(email), email.subject ?? ''));
      const fixture = queue?.find((candidate) => !matched.has(candidate.id));
      if (fixture) {
        matched.add(fixture.id);
        rows.push(auditEmail(fixture, email));
      }
      if (matched.size === CURATED_FIXTURES_V3.length || scanned >= MAX_SCAN) break;
    }

    if (matched.size === CURATED_FIXTURES_V3.length || scanned >= MAX_SCAN) break;
    cursor = page.nextCursor;
  } while (cursor);

  const missing = CURATED_FIXTURES_V3.filter((fixture) => !matched.has(fixture.id));
  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-curated-mailbox-v3-holdout',
    groundTruth: { commerce: COMMERCE_V3.length, noise: NOISE_V3.length, frozenBeforeFirstRun: true },
    productionWrites: 0,
    aiCalls: 0,
    expectedTotal: CURATED_FIXTURES_V3.length,
    matchedTotal: rows.length,
    coverage: rows.length / CURATED_FIXTURES_V3.length,
    scanned,
    summary: summarize(rows),
    missing,
    rows,
  };
}

function pageHtml(): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Holdout Audit v3</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1120px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:42px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:28px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.row{display:grid;grid-template-columns:120px 1fr 90px;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Holdout Audit v3</strong><a class="back" href="/audit-v2">v2 regression</a></div><section class="card"><div class="eyebrow">FRESH HOLDOUT · SHADOW · 0 WRITE · 0 AI</div><h1>100 új email</h1><p>50 commerce + 50 nehéz noise. A ground truth a motor módosítása nélkül lett lefagyasztva. Az első futás a v3 valódi holdout baseline-ja.</p><button id="run">Audit v3 futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},bad=(s.falseNegative||0)+(s.falsePositive||0),rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join(''),missing=(d.missing||[]).map(r=>'<div class="row"><span class="pill bad">missing</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(d.matchedTotal)+'/'+esc(d.expectedTotal)+'</strong><span>megtalált</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>hiba</span></div></div><p class="muted">TP '+esc(s.truePositive)+' · FN '+esc(s.falseNegative)+' · FP '+esc(s.falsePositive)+' · TN '+esc(s.trueNegative)+' · Scanned '+esc(d.scanned)+'</p>'+rows+missing}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Audit fut…';try{const res=await fetch('/api/audit/curated-mailbox-v3',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerCuratedMailboxAuditV3(app: FastifyInstance) {
  app.get('/audit-v3', async (_request, reply) => reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()));
  app.post('/api/audit/curated-mailbox-v3', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    try {
      const result = await runAuditV3(user.id);
      request.log.info({ userId: user.id, expectedTotal: result.expectedTotal, matchedTotal: result.matchedTotal, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Fresh holdout mailbox audit v3 completed');
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'curated_audit_v3_failed';
      request.log.error({ code }, 'Fresh holdout mailbox audit v3 failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
