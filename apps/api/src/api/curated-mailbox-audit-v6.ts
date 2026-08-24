import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;

type ExpectedKind = 'commerce' | 'noise';
interface CuratedFixture { id: string; expectedKind: ExpectedKind; sender: string; subject: string }

// Frozen in Gmail before the first v6 run. Do not edit this fixture set after the first run.
// Labels at freeze time: BuyFlow EML Audit/v6 Commerce (50), v6 Noise (50), v6 Holdout (100).
// The detector/parser engine is intentionally not changed by this audit PR.
const COMMERCE_V6 = [
  ["segito@alza.hu","602385238 sz. megrendelésed késve érkezik"],
  ["kozponti.ertesites@posta.hu","Csomagja a kézbesítőnél van"],
  ["googleplay-noreply@google.com","Google Play-rendelés (2026. aug. 16.) nyugtája"],
  ["googleplay-noreply@google.com","Előfizetésed (Yazio: Kalóriaszámláló) előnyei hamarosan véget ér"],
  ["googleplay-noreply@google.com","Google Play-rendelés (2026. júl. 16.) nyugtája"],
  ["googleplay-noreply@google.com","Google Play-rendelés (2026. júl. 9.) nyugtája"],
  ["segito@alza.hu","Vedd át 602385238 sz. megrendelésed"],
  ["segito@alza.hu","Már dolgozunk rajta. / 602385238 sz. megr."],
  ["googleplay-noreply@google.com","Yazio: Kalóriaszámláló-előfizetésedet töröljük"],
  ["googleplay-noreply@google.com","TMT Chow!-előfizetésedet töröljük"],
  ["ertesitesek@allegromail.com","Értesítés 13169408547018 HappyBox24 küldemény mai kézbesítéséről"],
  ["noreply@dpd.hu","Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény mai kézbesítéséről"],
  ["gyerekjatekbolt@gyerekjatekbolt.com","Sikeres bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!"],
  ["noreply@sinsay.com","A 15710474710 számú rendelésedet csomagolják."],
  ["ertesites@expressone.hu","Csomag kézbesítés ma – ETA és módosítás"],
  ["gyerekjatekbolt@gyerekjatekbolt.com","Gyerekjatekbolt.com - a(z) 536066. számú rendelés állapota megváltozott"],
  ["noreply@gls-hungary.com","GLS 3412614699 mai kézbesítése / GLS 3412614699 delivery today"],
  ["noreply@gls-hungary.com","GLS csomag információ / GLS parcel information"],
  ["ertesitesek@allegromail.com","Csomagja a kézbesítőnél van"],
  ["noreply@dorko.hu","DK2001799 - rendelésed úton van - átadtuk a GLS futárnak!"],
  ["noreply@dorko.hu","DK2001799 - rendelésed úton van - átadtuk a GLS futárnak!"],
  ["noreply@dorko.hu","DK2001799 - rendelésed úton van - átadtuk a GLS futárnak!"],
  ["noreply@gls-hungary.com","GLS 3406978622 mai kézbesítése / GLS 3406978622 delivery today"],
  ["shop@shopbuilder.hu","Csomagod úton"],
  ["noreply@gate.shop","Megrendelésének elküldése"],
  ["noreply@gls-hungary.com","GLS 3412842135 mai kézbesítése / GLS 3412842135 delivery today"],
  ["noreply@dpd.hu","Értesítés 16380143879559 LPP Hungary Kft./FC PDK küldemény feladásáról"],
  ["noreply@dpd.hu","Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény feladásáról"],
  ["noreply@sinsay.com","A 15710474710 számú rendelésed készen áll a szállításra."],
  ["ertesites@expressone.hu","Késik a kézbesítés – új ETA: 5 perc"],
  ["noreply@gls-hungary.com","GLS Átadópont csomaginformáció / GLS DeliveryPoints parcel information"],
  ["noreply@gls-hungary.com","GLS Átadópont csomaginformáció / GLS DeliveryPoints parcel information"],
  ["slip@expressone.hu","Fizetési bizonylat"],
  ["ertesites@expressone.hu","Küldemény feldolgozása megkezdődött"],
  ["ertesites@expressone.hu","Küldemény feldolgozása megkezdődött"],
  ["noreply@sinsay.com","Visszaigazolás arról, hogy a 15710474710 rendelést elküldték."],
  ["noreply@dpd.hu","Értesítés 16380124260518 küldemény előkészítéséről"],
  ["noreply@dpd.hu","Értesítés 16380143879559 küldemény előkészítéséről"],
  ["noreply@dpd.hu","Értesítés 16380124260338 küldemény előkészítéséről"],
  ["donotreply@mcdonalds.com","Fizetés megerősítése"],
  ["donotreply@mcdonalds.com","Fizetés megerősítése"],
  ["donotreply@mcdonalds.com","Fizetés megerősítése"],
  ["slip@expressone.hu","Fizetési bizonylat"],
  ["no-reply@foxpost.hu","Csomagod már a raktárunkban van"],
  ["no-reply@foxpost.hu","Előértesítés"],
  ["ertesitesek@allegro.hu","A futár ma érkezik. A következő termékeket tartalmazó csomagot szállítja ki: BROS KÉT KOMPONENSŰ SZER LÉGY ELLEN - ÚJ FORMULA"],
  ["donotreply@mcdonalds.com","Fizetés megerősítése"],
  ["donotreply@mcdonalds.com","Fizetés megerősítése"],
  ["no-reply@foxpost.hu","Csomagod megérkezett"],
  ["no-reply@foxpost.hu","Előértesítés"],
] as const;

const NOISE_V6 = [
  ["info@es.lampandlight.eu","Utolsó esély EXTRA kedvezmények"],
  ["recommendations@aboutyou.com","Új ajánlatok -25%-os kuponkóddal*!"],
  ["info@es.lampandlight.eu","Utolsó hét: 15%-os további kedvezmény 42.650Ft feletti vásárlás esetén"],
  ["info@xxlfoto.hu","☀️ 2000 Ft értékű kuponod érkezett!"],
  ["info@galaxy.hu","🚀 Légy az elsők között! A következő Galaxy élmény már vár rád!"],
  ["noreply@otp.hu","Új OTP vásárlási kedvezmények"],
  ["send@norabeauty.com","Meghosszabbítottuk a kedvezményt! 😍🎟️"],
  ["store+85580841304@g.shopifyemail.com","💖MEGLEPETÉS!💖 HAMARABB ÚJRA INDULT A CSOMAGFELADÁS!"],
  ["zamyra@zamyra.hu","💯AKCIÓÓÓ 🫨 KIÁRUSÍTÁS⛔"],
  ["marketing@retrojeans.com","⚡ FLASH SALE – DENIM20: MOST 20% KEDVEZMÉNY A DENIM TERMÉKEKRE"],
  ["noreply@otp.hu","Hamarosan lejáró OTP vásárlási kedvezmények"],
  ["megbizhatobolt@arukereso.hu","Elégedett volt Kartonshop.hu webáruházban történt vásárlással?"],
  ["megbizhatobolt@arukereso.hu","Elégedett volt Gyerekjatekbolt.com játék webáruház webáruházban történt vásárlással?"],
  ["message@message.sinsay.com","Ingyenes szállítás MINDENRE 🚚"],
  ["info@es.lampandlight.eu","42.650 Ft feletti rendelések esetén további 15% kedvezményt kap"],
  ["send@norabeauty.com","⏰ Ingyenes szállítás: ma éjfélig! ⏰"],
  ["rossmann@hirlevel.rossmann.hu","🧺 Hamarosan indul a Tiszta Spórolás Kuponnapok a Rossmann-ban!"],
  ["info@drforrai.hu","❤️ Dr.Forrai Öngondoskodás Hete: -25% kedvezmény a csomagokra, -20% minden termékünkön"],
  ["megbizhatobolt@arukereso.hu","Emlékeztető: Elégedett volt Kávégép Bolt webáruházban történt vásárlással?"],
  ["hirlevel@maileon.pepita.hu","Hahó, 0 Ft-os szállítás a megjelölt Candy nagygépekre 🚚🔌"],
  ["info@xxlfoto.hu","🎁📸 Prémium fénykép akció választható ajándékkal!"],
  ["info@galaxy.hu","🎁 Fantasztikus csomagajánlatok a Samsung Experience Store-okban! - Spórolj akár 40 000 Forintot"],
  ["promotion@zentrada.hu","Őszi akciók helyhez kötött üzletek számára: szezonális highlight termékek és erős kiegészítő kínálatok"],
  ["message@message.sinsay.com","🧡 -2 900 HUF 🧡"],
  ["szia@awgifts.hu","🌿 Utolsó esély: 30% kedvezmény a nepáli kenderkollekcióra – csak ma éjfélig!"],
  ["reviews@trustmate.io","💌 Oszd meg a véleményed az általad rendelt termékekről!"],
  ["akcio@akcio.lampak.hu","Ma midnight lejár az extra 25% kedvezmény a kijelölt 30 modellre!"],
  ["info@oxygenihair.com","Eljött a nyári pihenés ideje☀️ – fontos információ rendeléseidhez"],
  ["noreply@nedm.asus.com","Csütörtökön új akcióval érkezünk!"],
  ["info@xxlfoto.hu","❄️ Hűsítő ajánlat: 50 db 10x15 cm-es fénykép 3500 Ft"],
  ["rossmann@hirlevel.rossmann.hu","✨ 25% kedvezmény a L'oréal dekorkozmetikai termékekre Rossmann+ tagoknak!"],
  ["info@hirek.packeta.hu","Küldj csomagot kedvezményesen az új FOXPOST appon keresztül"],
  ["news@letter.alza.hu","AlzaPlus+ tagoknak 5–30% kedvezmény"],
  ["webshop@zalapack.hu","⏳ Fontos információ rendeléseivel kapcsolatban – nyári szállítási idők"],
  ["meki@m.mcdonalds.hu","Hoztunk egy hűsítő kedvezményt ❄️"],
  ["kfc@kfc.hu","Augusztus 20-án is KFC? Mutatjuk, hol! 🍗🎆"],
  ["ea@e.ea.com","ALL. SYSTEMS. GO."],
  ["kfc@kfc.hu","Dos Tacos? Ne maradj le, 2 Taco helyben fogyasztva csak 1290 Ft! ! 🌮🌮"],
  ["news@exisport.hu","Szia, mire vársz még Gábor?"],
  ["newsletter@hirlevel.jatekbolt.hu","⏰Két hét múlva kezdődik a suli⏰"],
  ["promotion@zentrada.hu","Praktikus őszi választékok az otthon és konyha számára"],
  ["info@myenergy.eon.hu","Új okosklíma bevezető áron – 99 900 Ft kezdőrészlettől"],
  ["info@heroclothing.eu","A 15% kedvezmény a HERO Pólóingekre ma este véget ér"],
  ["newsletter@hirlevel.jatekbolt.hu","ÁFA-mentes napok meghosszabbítva! Vásárolj be sulikezdésre!"],
  ["noreply@hirlevel.vectraline.hu","🛒 Friss heti ajánlatok érkeztek!"],
  ["hirlevel@okosgazdi.hu","🐈 Négy íz egy kartonban cicád változatos étkezéséért"],
  ["akcio@akcio.lampak.hu","Lámpák mega vására. Csak vasárnapig -25% a kuponkóddal!"],
  ["info@galaxy.hu","🎉 Megérkeztünk Pécsre! Grand Opening exkluzív ajánlatokkal"],
  ["send@norabeauty.com","A Te véleményed = a jövő Nora Beauty-ja 💜🦌"],
  ["news@exisport.hu","Nézz jól körül, Gábor."],
] as const;

const CURATED_FIXTURES_V6: CuratedFixture[] = [
  ...COMMERCE_V6.map(([sender, subject], index) => ({ id: `commerce-v6-${String(index + 1).padStart(2, '0')}`, expectedKind: 'commerce' as const, sender, subject })),
  ...NOISE_V6.map(([sender, subject], index) => ({ id: `noise-v6-${String(index + 1).padStart(2, '0')}`, expectedKind: 'noise' as const, sender, subject })),
];

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) { await reply.code(401).send({ error: 'unauthorized' }); return null; }
  return user;
}

function norm(value: string) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}
function key(sender: string, subject: string) { return `${norm(sender)}\n${norm(subject)}`; }
function primarySender(email: NormalizedEmail) { return email.from[0]?.email?.trim().toLowerCase() ?? ''; }
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

async function runAuditV6(userId: string) {
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
  for (const fixture of CURATED_FIXTURES_V6) {
    const fixtureKey = key(fixture.sender, fixture.subject);
    const queue = queues.get(fixtureKey) ?? [];
    queue.push(fixture);
    queues.set(fixtureKey, queue);
  }

  const matched = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let cursor: string | undefined;
  do {
    const page = await provider.searchMessages({
      query: 'label:"BuyFlow EML Audit/v6 Holdout" -in:spam -in:trash',
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    for (const email of page.messages) {
      scanned += 1;
      const queue = queues.get(key(primarySender(email), email.subject ?? ''));
      const fixture = queue?.find((candidate) => !matched.has(candidate.id));
      if (fixture) {
        matched.add(fixture.id);
        rows.push(audit(fixture, email));
      }
      if (matched.size === CURATED_FIXTURES_V6.length || scanned >= MAX_SCAN) break;
    }
    if (matched.size === CURATED_FIXTURES_V6.length || scanned >= MAX_SCAN) break;
    cursor = page.nextCursor;
  } while (cursor);

  const missing = CURATED_FIXTURES_V6.filter((fixture) => !matched.has(fixture.id));
  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-curated-mailbox-v6-holdout',
    groundTruth: {
      commerce: COMMERCE_V6.length,
      noise: NOISE_V6.length,
      frozenBeforeFirstRun: true,
      gmailLabels: ['BuyFlow EML Audit/v6 Commerce', 'BuyFlow EML Audit/v6 Noise', 'BuyFlow EML Audit/v6 Holdout'],
      detectorBaselineCommit: '6399522a6a806ebc39db8cbbb9cf80078e064c9b',
    },
    productionWrites: 0,
    aiCalls: 0,
    expectedTotal: CURATED_FIXTURES_V6.length,
    matchedTotal: rows.length,
    coverage: rows.length / CURATED_FIXTURES_V6.length,
    scanned,
    summary: summarize(rows),
    missing,
    rows,
  };
}

function pageHtml(): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Holdout Audit v6</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1120px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:42px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:28px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.row{display:grid;grid-template-columns:120px 1fr 90px;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Holdout Audit v6</strong><a class="back" href="/audit-v5">v5 regression</a></div><section class="card"><div class="eyebrow">BLIND SET · SHADOW · 0 WRITE · 0 AI</div><h1>100 új email</h1><p>50 commerce + 50 nehéz noise. A Gmailben előre lefagyasztott v6 holdoutot ugyanaz a determinisztikus BuyFlow motor értékeli; ez az oldal nem módosít production adatot és nem hív AI-t.</p><button id="run">Audit v6 futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},bad=(s.falseNegative||0)+(s.falsePositive||0),rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join(''),missing=(d.missing||[]).map(r=>'<div class="row"><span class="pill bad">missing</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(d.matchedTotal)+'/'+esc(d.expectedTotal)+'</strong><span>megtalált</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>hiba</span></div></div><p class="muted">TP '+esc(s.truePositive)+' · FN '+esc(s.falseNegative)+' · FP '+esc(s.falsePositive)+' · TN '+esc(s.trueNegative)+' · Scanned '+esc(d.scanned)+'</p>'+rows+missing}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Audit fut…';try{const res=await fetch('/api/audit/curated-mailbox-v6',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerCuratedMailboxAuditV6(app: FastifyInstance) {
  app.get('/audit-v6', async (_request, reply) => reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()));
  app.post('/api/audit/curated-mailbox-v6', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const result = await runAuditV6(user.id);
      request.log.info({ userId: user.id, expectedTotal: result.expectedTotal, matchedTotal: result.matchedTotal, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Fresh holdout mailbox audit v6 completed');
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'curated_audit_v6_failed';
      request.log.error({ code }, 'Fresh holdout mailbox audit v6 failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
