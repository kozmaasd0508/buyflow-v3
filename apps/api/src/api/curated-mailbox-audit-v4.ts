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

// Frozen before the first v4 run, after generic-commerce-v5-shadow was already live.
// 50 commerce + 50 hard noise, none selected from the previous v1/v2/v3 holdout labels.
const COMMERCE_V4 = [
  ['info@service.gymbeam.hu', 'Gáborné a számlád elkészült! - 3010354660'],
  ['ertesites@expressone.hu', 'Csomag kézbesítés ma – ETA és módosítás'],
  ['ertesites@expressone.hu', 'Küldemény feldolgozása megkezdődött'],
  ['info@service.gymbeam.hu', 'Gáborné, a megrendelésed úton van!'],
  ['info@service.gymbeam.hu', 'Gáborné, a rendelésed feldolgozás alatt van.'],
  ['ertesitesek@allegromail.com', 'Értesítés 13169408547018 sikeres kézbesítéséről'],
  ['noreply@billingo.hu', 'Számlája érkezett'],
  ['no-reply@foxpost.hu', 'Csomagod megérkezett'],
  ['gyerekjatekbolt@gyerekjatekbolt.com', 'Gyerekjatekbolt.com – a(z) 535574. számú rendeléshez tartozó tranzakció sikertelen volt'],
  ['ertesitesek@allegro.com', 'Megvásároltad: 3 db-os kulacs szett motivációs edzéshez 1500ml+600ml+200ml + 1 egyéb termék HappyBox24 eladótól.'],
  ['no-reply@foxpost.hu', 'Csomagod megérkezett'],
  ['no-reply@foxpost.hu', 'Csomagod már a raktárunkban van'],
  ['noreply@packeta.hu', 'A szállítmányt elfogadták a szállításra'],
  ['noreply@gate.shop', 'Megrendelésének elküldése'],
  ['no-reply@foxpost.hu', 'Előértesítés'],
  ['noreply@gate.shop', 'Köszönjük, hogy a Gate-nél vásárolt.'],
  ['kozponti.ertesites@posta.hu', 'Csomagod a postán átvehető'],
  ['kozponti.ertesites@posta.hu', 'Csomagod a kézbesítőnél van'],
  ['kozponti.ertesites@posta.hu', 'Csomagot adtak fel neked'],
  ['szidibox@gmail.com', 'Szidibox Karton Kft. Webáruház - Megrendelését összekészítettük SO-2024-30411'],
  ['donotreply@mcdonalds.com', 'Fizetés megerősítése'],
  ['info@service.gymbeam.hu', 'Gáborné a számlád elkészült! - 3010206178'],
  ['info@service.gymbeam.hu', 'Gáborné a számlád elkészült! - 3010228912'],
  ['ertesites@expressone.hu', 'Küldemény kézbesítve – kérdőív'],
  ['ertesites@expressone.hu', 'Küldemény kézbesítve – kérdőív'],
  ['ertesites@expressone.hu', 'Késik a kézbesítés – új ETA: 5 perc'],
  ['ertesites@expressone.hu', 'Csomag kézbesítés ma – ETA és módosítás'],
  ['ertesites@expressone.hu', 'Küldemény feldolgozása megkezdődött'],
  ['no-reply@foxpost.hu', 'Csomagod megérkezett'],
  ['info@service.gymbeam.hu', 'Kozma, a megrendelésed úton van!'],
  ['info@service.gymbeam.hu', 'Gáborné, a rendelésed feldolgozás alatt van.'],
  ['no-reply@foxpost.hu', 'Csomagod már a raktárunkban van'],
  ['ertesites@expressone.hu', 'Küldemény feldolgozása megkezdődött'],
  ['info@support.gymbeam.hu', 'Re: 605855685055000013605231 - 3010206178 - [FKN-HKKTL-917]'],
  ['no-reply@foxpost.hu', 'Át nem vett csomagodat visszaszállítottuk'],
  ['szamla@szamlakozpont.hu', 'BioTechUSA Kft. e-invoice has arrived! (invoice number: BBE2026147558) / BioTechUSA Kft. elektronikus számlája érkezett! (sorszáma: BBE2026147558)'],
  ['no-reply@foxpost.hu', 'Előértesítés'],
  ['shop@scitec.hu', 'Kedves Kozma Gábor, Scitec Nutrition rendelésed: 2026-07-13 22:51:16-kor rögzítettük! (1783-975-87-395)'],
  ['noreply@gls-hungary.com', 'Utánvétes fizetés visszaigazolás'],
  ['no-reply@foxpost.hu', 'Csomagod megérkezett'],
  ['info@service.gymbeam.hu', 'Gáborné, a megrendelésed úton van!'],
  ['info@service.gymbeam.hu', 'Gáborné, a rendelésed feldolgozás alatt van.'],
  ['noreply@gls-hungary.com', 'Értesítés a 3408405568 számú csomag GLS Automatába helyezéséről'],
  ['barion@barion.com', 'Sikeres fizetés'],
  ['info@service.gymbeam.hu', 'Gáborné a számlád elkészült! - 3010185433'],
  ['ertesites@expressone.hu', 'Küldemény kézbesítve – kérdőív'],
  ['ertesites@expressone.hu', 'Késik a kézbesítés – új ETA: 5 perc'],
  ['no-reply@foxpost.hu', 'Csomagod megérkezett'],
  ['ertesites@expressone.hu', 'Csomag kézbesítés ma – ETA és módosítás'],
  ['info@limone.hu', 'Parfümök online a Limone.hu-n - Automata megrendelés visszaigazolás - 98691-106392'],
] as const;

const NOISE_V4 = [
  ['noreply@limitedresell.com', 'Offres spéciales pour la rentrée 🎒'],
  ['info@drforrai.hu', '😱 UV-folt, kiszáradás, tágult pórusok – a nyár bőrre gyakorolt hatásai és a megoldás'],
  ['hirlevel@eu-solar.hu', 'Ugye nem akar egyetlen percre sem áram nélkül maradni?'],
  ['support@appscenic.com', 'Want to make your first $1K? Start with the right products🔎'],
  ['hello@retrojeans.com', 'Late Night Shopping: 20% kedvezmény'],
  ['tips@nylas.com', 'Moving from sandbox to production: what changes and what to do before you flip the switch'],
  ['hirlevel@eu-solar.hu', 'Ugye nem akar egyetlen percre sem áram nélkül maradni?'],
  ['team@mail.base44.com', "Build the app someone's been waiting for"],
  ['rossmann@hirlevel.rossmann.hu', '✨ 35% kedvezmény a megjelölt Bref toalett-frissítőkre!'],
  ['wholesale@7717122.brevosend.com', 'New in stock: Discover new product ✨'],
  ['info@join.netflix.com', 'Seal Team 7. évad – már megérkezett'],
  ['info@es.lampandlight.eu', '15% kedvezmény kizárólag előfizetőknek'],
  ['no-reply@primevideo.com', 'Készen állsz a(z) Amerikába jöttem 2 befejezésére?'],
  ['send@norabeauty.com', 'Nóri tanácsa: így használd a Nora Beauty szérumokat ✨💜'],
  ['message@news2.zalando.com', 'Vissza a nyaralásból? Irány a munkába stílusban!'],
  ['sylvestre@parseur.com', '3 ways?'],
  ['news@letter.alza.hu', 'Saját márkáink szenzációs áron az Alza napokon'],
  ['info@join.netflix.com', '1670 3. évad – már megérkezett'],
  ['wholesale@7717122.brevosend.com', 'Discover Our New Gift Sets ✨'],
  ['noreply@gate.shop', 'EXTRA -30% a meghatározott termékekre 💛'],
  ['rossmann@hirlevel.rossmann.hu', '🎁 Regisztrálj a Rossmann+ programba és 20% kedvezménnyel ajándékozunk meg!'],
  ['hirlevel@eu-solar.hu', 'Kiszolgáltatott lett a magyar energiarendszer az importnak – Így fordítsa a saját javára!'],
  ['noreply@limitedresell.com', 'Back to school deals 🎒'],
  ['hirlevel@eu-solar.hu', 'Kiszolgáltatott lett a magyar energiarendszer az importnak – Így fordítsa a saját javára!'],
  ['sylvestre@parseur.com', "Setting up your mailbox? We're here to help"],
  ['hi@creativefabrica.com', 'Everything you need to edit images, free on your PC or Mac'],
  ['store+85580841304@g.shopifyemail.com', 'ÚRISTEN 😍 Megérkezett… és van egy meglepetésem is! 🎀'],
  ['hirlevel@eu-solar.hu', 'Gondoskodjon magáról akkor is, ha Paks teljesen leáll – Kérjen helyszíni tanácsadást!'],
  ['sylvestre@parseur.com', 'one mailbox or many?'],
  ['hirlevel@eu-solar.hu', 'Gondoskodjon magáról akkor is, ha Paks teljesen leáll – Kérjen helyszíni tanácsadást!'],
  ['rossmann@hirlevel.rossmann.hu', '⏰ Happy Hour 1 órán át: 2+1 kedvezmény a megjelölt WINSTON macskaeledelekre!'],
  ['online@plastortrading.ro', '🌞 Soare, vacanță și oferte de vară pe care să nu le ratezi! 🏖️'],
  ['online@plastortrading.ro', '🌞 Soare, vacanță și oferte de vară pe care să nu le ratezi! 🏖️'],
  ['news@mg.klarstein.com', 'Kozma, régóta nem láttuk egymást... Még mindig érdeklik az e-mailjeink?'],
  ['rossmann@hirlevel.rossmann.hu', '🪄 Tiszta Spórolás Kuponnapok: Vásárolj kedvezményesen 08.16-ig!'],
  ['noreply@gate.shop', 'Visszatér a varsity stílus 🎓'],
  ['ea@e.ea.com', 'BE. THE. DANGER. 🕶️'],
  ['sylvestre@parseur.com', "Here's how to choose the right plan for you"],
  ['noreply@nedm.asus.com', 'Exkluzív nyereményjáték a Gamescom 2026 alkalmából! 🎁'],
  ['noreply@nedm.asus.com', 'Regisztráld ROG terméked, és nyerj Pókember-ajándékcsomagot!'],
  ['team@mail.base44.com', 'Your app just got new powers'],
  ['info@oxygenihair.com', '20% kedvezmény az Oxygeni webshopban – csak augusztus 25-ig!'],
  ['info@angol.relyon-marketing.com', '🍀Ingyenes angol képzés + álláskeresési támogatás'],
  ['marketing@retrojeans.com', 'A NYÁRI LEÁRAZÁS FOLYTATÓDIK – MOST AKÁR -70%'],
  ['news@updates.ubisoft.com', 'Our Gamescom Sale is live!'],
  ['message@news2.zalando.com', 'Még felhasználhatod a 15%-os kedvezményedet'],
  ['hirlevel@eu-solar.hu', 'Így válaszolhatja meg a 24 órás önellátás kérdését'],
  ['wholesale@7717122.brevosend.com', 'Finally here. Worth the wait!!'],
  ['info@mail.puellaillatok.hu', 'A ruháid jobbat érdemelnek'],
  ['news@letter.alza.hu', 'Akciók nyárra és az iskolakezdésre'],
] as const;

const CURATED_FIXTURES_V4: CuratedFixture[] = [
  ...COMMERCE_V4.map(([sender, subject], index) => ({ id: `commerce-v4-${String(index + 1).padStart(2, '0')}`, expectedKind: 'commerce' as const, sender, subject })),
  ...NOISE_V4.map(([sender, subject], index) => ({ id: `noise-v4-${String(index + 1).padStart(2, '0')}`, expectedKind: 'noise' as const, sender, subject })),
];

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) { await reply.code(401).send({ error: 'unauthorized' }); return null; }
  return user;
}
function norm(value: string) { return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase(); }
function key(sender: string, subject: string) { return `${norm(sender)}\n${norm(subject)}`; }
function primarySender(email: NormalizedEmail) { return email.from[0]?.email?.trim().toLowerCase() ?? ''; }
function detectedCommerce(classification: string | null) { return Boolean(classification && classification !== 'other' && !classification.startsWith('security_')); }
function audit(fixture: CuratedFixture, email: NormalizedEmail) {
  const plan = planNormalizedInboundEmail({ email });
  const commerce = detectedCommerce(plan.classification);
  const verdict = fixture.expectedKind === 'commerce' ? (commerce ? 'true_positive' : 'false_negative') : (commerce ? 'false_positive' : 'true_negative');
  return { id: fixture.id, expectedKind: fixture.expectedKind, sender: email.from[0]?.email ?? null, subject: email.subject ?? null, classification: plan.classification, parserVersion: plan.parserVersion, recognitionStatus: plan.status, validationStatus: plan.validationStatus, detectedCommerce: commerce, verdict, productionWrites: 0, aiCalls: 0 };
}
function summarize(rows: Array<Record<string, unknown>>) {
  const count = (v: string) => rows.filter((r) => r.verdict === v).length;
  const tp = count('true_positive'), fn = count('false_negative'), fp = count('false_positive'), tn = count('true_negative');
  return { truePositive: tp, falseNegative: fn, falsePositive: fp, trueNegative: tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}
async function runAuditV4(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db.from('email_connections').select('id,provider_account_id,email_address').eq('user_id', userId).eq('provider', 'nylas').eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');
  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: connection.provider_account_id });
  const queues = new Map<string, CuratedFixture[]>();
  for (const fixture of CURATED_FIXTURES_V4) { const k = key(fixture.sender, fixture.subject); const q = queues.get(k) ?? []; q.push(fixture); queues.set(k, q); }
  const matched = new Set<string>(); const rows: Array<Record<string, unknown>> = []; let scanned = 0; let cursor: string | undefined;
  do {
    const page = await provider.searchMessages({ query: 'newer_than:365d -in:spam -in:trash', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    for (const email of page.messages) {
      scanned += 1;
      const q = queues.get(key(primarySender(email), email.subject ?? ''));
      const fixture = q?.find((candidate) => !matched.has(candidate.id));
      if (fixture) { matched.add(fixture.id); rows.push(audit(fixture, email)); }
      if (matched.size === CURATED_FIXTURES_V4.length || scanned >= MAX_SCAN) break;
    }
    if (matched.size === CURATED_FIXTURES_V4.length || scanned >= MAX_SCAN) break;
    cursor = page.nextCursor;
  } while (cursor);
  const missing = CURATED_FIXTURES_V4.filter((f) => !matched.has(f.id));
  return { ok: true, mode: 'shadow', source: 'nylas-curated-mailbox-v4-holdout', groundTruth: { commerce: COMMERCE_V4.length, noise: NOISE_V4.length, frozenBeforeFirstRun: true, detectorBaseline: 'generic-commerce-v5-shadow' }, productionWrites: 0, aiCalls: 0, expectedTotal: CURATED_FIXTURES_V4.length, matchedTotal: rows.length, coverage: rows.length / CURATED_FIXTURES_V4.length, scanned, summary: summarize(rows), missing, rows };
}
function pageHtml(): string {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Holdout Audit v4</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1120px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:42px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:28px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.row{display:grid;grid-template-columns:120px 1fr 90px;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Holdout Audit v4</strong><a class="back" href="/audit-v3">v3 regression</a></div><section class="card"><div class="eyebrow">FRESH HOLDOUT · V5 FROZEN · SHADOW · 0 WRITE · 0 AI</div><h1>100 új email</h1><p>50 commerce + 50 nehéz noise. A készlet a generic-commerce-v5-shadow után, további motor-módosítás nélkül lett lefagyasztva.</p><button id="run">Audit v4 futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},bad=(s.falseNegative||0)+(s.falsePositive||0),rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.verdict==='true_positive'||r.verdict==='true_negative'?'good':'bad')+'">'+esc(r.verdict)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.parserVersion||'nincs parser')+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join(''),missing=(d.missing||[]).map(r=>'<div class="row"><span class="pill bad">missing</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+'</div></div><span class="pill">'+esc(r.expectedKind)+'</span></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+esc(d.matchedTotal)+'/'+esc(d.expectedTotal)+'</strong><span>megtalált</span></div><div class="metric"><strong class="good">'+pct(s.precision)+'</strong><span>precision</span></div><div class="metric"><strong class="good">'+pct(s.recall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(bad?'bad':'good')+'">'+bad+'</strong><span>hiba</span></div></div><p class="muted">TP '+esc(s.truePositive)+' · FN '+esc(s.falseNegative)+' · FP '+esc(s.falsePositive)+' · TN '+esc(s.trueNegative)+' · Scanned '+esc(d.scanned)+'</p>'+rows+missing}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Audit fut…';try{const res=await fetch('/api/audit/curated-mailbox-v4',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}
export async function registerCuratedMailboxAuditV4(app: FastifyInstance) {
  app.get('/audit-v4', async (_request, reply) => reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()));
  app.post('/api/audit/curated-mailbox-v4', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    try { const result = await runAuditV4(user.id); request.log.info({ userId: user.id, expectedTotal: result.expectedTotal, matchedTotal: result.matchedTotal, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Fresh holdout mailbox audit v4 completed'); return reply.code(200).send(result); }
    catch (error) { const code = error instanceof Error ? error.message : 'curated_audit_v4_failed'; request.log.error({ code }, 'Fresh holdout mailbox audit v4 failed'); return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code }); }
  });
}
