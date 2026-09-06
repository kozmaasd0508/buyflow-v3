import process from 'node:process';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.BUYFLOW_CHAT_MODEL || 'gemma3:12b';

const emails = [
  {id:'E01',from:'rendeles@gymbeam.hu',subject:'Rendelésed megérkezett – GB-48271',body:'Köszönjük rendelésed! Rendelési azonosító: GB-48271. Összeg: 18 490 Ft. Szállítás: GLS. A rendelést feldolgozzuk.'},
  {id:'E02',from:'noreply@simplepay.hu',subject:'Sikeres fizetés',body:'A fizetés sikeres. Kereskedő: GymBeam. Kereskedői rendelésazonosító: GB-48271. Tranzakció: SP-884201. Összeg: 18 490 Ft.'},
  {id:'E03',from:'shipping@gymbeam.hu',subject:'Csomagodat átadtuk a futárnak – GB-48271',body:'A GB-48271 rendelésedet átadtuk a GLS részére. Csomagszám: GLS111222333HU. A csomag úton van.'},
  {id:'E04',from:'info@gls-hungary.com',subject:'A csomagot kézbesítettük',body:'A GLS111222333HU csomagszámú küldeményt ma 14:26-kor sikeresen kézbesítettük a címzettnek.'},

  {id:'E05',from:'no-reply@notino.hu',subject:'Köszönjük rendelésed – N-903114',body:'Rendelés száma: N-903114. Termékek: 2 db parfüm. Fizetve. A csomag összeállítása megkezdődött.'},
  {id:'E06',from:'szamla@billingo.hu',subject:'Elektronikus számla – Notino',body:'A Notino megbízásából küldött számla. Kapcsolódó rendelés: N-903114. Számlaszám: NTO-2026-77821.'},
  {id:'E07',from:'info@expressone.hu',subject:'Küldeményadat rögzítve',body:'A feladó Notino előkészítette küldeményét. Rendelés: N-903114. Express One csomagszám: EO778899001. A csomag fizikai átvétele a futártól még nem történt meg.'},
  {id:'E08',from:'info@expressone.hu',subject:'Ma kézbesítjük csomagját',body:'Az EO778899001 azonosítójú csomag a kézbesítő futárnál van, várható kézbesítés ma 12:00–15:00 között.'},

  {id:'E09',from:'marketplace@emag.hu',subject:'Rendelés visszaigazolás – 55021',body:'eMAG rendelés: 55021. Eladó partner: TechPoint Kft. Termék: fejhallgató. A rendelést rögzítettük.'},
  {id:'E10',from:'marketplace@emag.hu',subject:'Az eladó feladta a rendelésed',body:'eMAG rendelés 55021. A TechPoint Kft. átadta a csomagot az MPL-nek. Nyomkövetési szám: MPL44556677.'},
  {id:'E11',from:'ertesites@posta.hu',subject:'Csomagja átvehető',body:'Az MPL44556677 küldemény megérkezett a Szolnok 1 Postára és a címzett számára átvehető.'},
  {id:'E12',from:'szamla@szamlazz.hu',subject:'Számla – TechPoint Kft.',body:'Vevői rendelés: eMAG 55021. Számlaszám: TP-2026-3318. Kibocsátó: TechPoint Kft.'},

  {id:'E13',from:'rendeles@dorko.hu',subject:'Rendelésed rögzítettük – DK-77105',body:'Köszönjük! Rendelésszám: DK-77105. Cipő, 1 db. Fizetés bankkártyával.'},
  {id:'E14',from:'rendeles@dorko.hu',subject:'Rendelésed rögzítettük – DK-77188',body:'Köszönjük! Rendelésszám: DK-77188. Póló, 2 db. Fizetés bankkártyával.'},
  {id:'E15',from:'csomag@dorko.hu',subject:'Feladtuk a csomagod – DK-77105',body:'A DK-77105 rendelést átadtuk a GLS-nek. Csomagszám: GLS99887766HU.'},
  {id:'E16',from:'refund@dorko.hu',subject:'Visszatérítés elindítva – DK-77188',body:'A DK-77188 rendelésből visszaküldött pólók árának visszatérítését elindítottuk. Összeg: 13 998 Ft.'},

  {id:'E17',from:'hirlevel@emag.hu',subject:'Csak ma -30% a kiválasztott termékekre!',body:'Őrült hétvégi akció! Kattints és vásárolj most. Ez egy marketing hírlevél, rendelési állapotot nem közöl.'},
  {id:'E18',from:'security@notino.hu',subject:'Új bejelentkezés a fiókodba',body:'Új bejelentkezést észleltünk. Ha nem te voltál, változtasd meg a jelszavad. Ez nem rendelési értesítés.'},
  {id:'E19',from:'info@expressone.hu',subject:'Futár érkezik a feladandó csomagért',body:'Tisztelt Limone! Futárunk ma 15:00 és 17:00 között felveszi Öntől a feladandó webshop csomagokat. Ez a kereskedő kimenő küldeménye, nem az Ön vásárlása.'},
  {id:'E20',from:'survey@gls-hungary.com',subject:'Mennyire volt elégedett a kézbesítéssel?',body:'Kérjük értékelje a GLS111222333HU csomag kézbesítését. Töltse ki 1 perces kérdőívünket. Új kézbesítési eseményt nem közlünk.'}
];

const expected = {
  E01:['GB-48271','ORDER_CREATED'], E02:['GB-48271','PAYMENT'], E03:['GB-48271','SHIPPED'], E04:['GB-48271','DELIVERED'],
  E05:['N-903114','ORDER_PROCESSING'], E06:['N-903114','INVOICE'], E07:['N-903114','SHIPMENT_CREATED'], E08:['N-903114','OUT_FOR_DELIVERY'],
  E09:['55021','ORDER_CREATED'], E10:['55021','SHIPPED'], E11:['55021','READY_FOR_PICKUP'], E12:['55021','INVOICE'],
  E13:['DK-77105','ORDER_CREATED'], E14:['DK-77188','ORDER_CREATED'], E15:['DK-77105','SHIPPED'], E16:['DK-77188','REFUNDED'],
  E17:[null,'OTHER'], E18:[null,'OTHER'], E19:[null,'OTHER'], E20:[null,'OTHER']
};

const allowedEvents = ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','RETURNED','REFUNDED','WARRANTY','OTHER'];

const schema = {
  type:'object',
  properties:{
    emails:{type:'array',items:{type:'object',properties:{
      id:{type:'string'},
      event_type:{type:'string',enum:allowedEvents},
      purchase_key:{anyOf:[{type:'string'},{type:'null'}]},
      role:{type:'string',enum:['BUYER_PURCHASE','JUNK_OTHER','UNCERTAIN']},
      evidence:{type:'string'},
      confidence:{type:'number',minimum:0,maximum:1}
    },required:['id','event_type','purchase_key','role','evidence','confidence'],additionalProperties:false}},
    purchase_groups:{type:'array',items:{type:'object',properties:{
      purchase_key:{type:'string'}, email_ids:{type:'array',items:{type:'string'}}, explanation:{type:'string'}
    },required:['purchase_key','email_ids','explanation'],additionalProperties:false}},
    junk_email_ids:{type:'array',items:{type:'string'}},
    summary:{type:'string'}
  },required:['emails','purchase_groups','junk_email_ids','summary'],additionalProperties:false
};

const system = `You are being tested as BuyFlow's semantic email analyst. This is a BLIND synthetic test: you are not given the answer key.
Analyze all 20 emails jointly. Determine what each email means, which buyer purchase it belongs to, and link related emails only when there is concrete evidence such as exact order ID or a tracking ID chain already attached to an order.
Do not group merely because merchant names match or dates are close.
Use purchase_key as the canonical order number when it can be established. If the email is marketing, account security, survey-only, or merchant/mailbox-owner outbound logistics, use event_type OTHER, role JUNK_OTHER, purchase_key null.
Important semantics: label/pre-advice without physical handoff = SHIPMENT_CREATED; seller says handed to courier = SHIPPED; courier out today = OUT_FOR_DELIVERY; waiting for recipient = READY_FOR_PICKUP; completed = DELIVERED. Explain evidence briefly. Return only the required JSON.`;

async function main(){
  const health = await fetch(`${OLLAMA}/api/tags`);
  if(!health.ok) throw new Error(`Ollama unavailable: HTTP ${health.status}`);
  const prompt = `Here are the 20 emails in shuffled mixed order:\n\n${emails.map(e=>`[${e.id}]\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body}`).join('\n\n')}`;
  console.log('BUYFLOW GEMMA LINKING20 BLIND TEST');
  console.log(`Model: ${MODEL}`);
  console.log('20 synthetic mixed emails | no Gmail | no BuyFlow writes | answer key hidden from model');
  console.log('Gemma is analyzing...\n');
  const r = await fetch(`${OLLAMA}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:prompt}],stream:false,format:schema,options:{temperature:0.1,num_ctx:16384}})});
  if(!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const j=await r.json();
  const raw=j?.message?.content;
  if(!raw) throw new Error('Empty response');
  let out; try{out=JSON.parse(raw);}catch{console.log(raw); throw new Error('Model output was not valid JSON');}
  const byId=new Map((out.emails||[]).map(x=>[x.id,x]));
  let eventOk=0, linkOk=0, roleOk=0;
  console.log('RESULTS');
  console.log('--------------------------------------------------------------------------------');
  for(const e of emails){
    const a=byId.get(e.id); const [expKey,expEvent]=expected[e.id];
    const gotKey=a?.purchase_key ?? null; const gotEvent=a?.event_type ?? 'MISSING';
    const ek=gotEvent===expEvent; const lk=(gotKey===expKey); const expectedRole=expEvent==='OTHER'?'JUNK_OTHER':'BUYER_PURCHASE'; const rk=a?.role===expectedRole;
    if(ek)eventOk++; if(lk)linkOk++; if(rk)roleOk++;
    console.log(`${e.id} ${ek&&lk&&rk?'PASS':'CHECK'} | event ${gotEvent} ${ek?'✓':`✗ expected ${expEvent}`} | order ${gotKey??'-'} ${lk?'✓':`✗ expected ${expKey??'-'}`}`);
    console.log(`    ${a?.evidence||'(no evidence)'}`);
  }
  console.log('--------------------------------------------------------------------------------');
  console.log(`EVENT: ${eventOk}/20`);
  console.log(`ORDER/LINK: ${linkOk}/20`);
  console.log(`BUYER vs JUNK: ${roleOk}/20`);
  const perfect=[...byId.keys()].filter(id=>{const a=byId.get(id);const [k,v]=expected[id];return a?.event_type===v&&(a?.purchase_key??null)===k&&a?.role===(v==='OTHER'?'JUNK_OTHER':'BUYER_PURCHASE');}).length;
  console.log(`FULL EXACT: ${perfect}/20`);
  console.log('\nGemma purchase groups:');
  for(const g of out.purchase_groups||[]) console.log(`- ${g.purchase_key}: ${(g.email_ids||[]).join(', ')} | ${g.explanation}`);
  console.log(`\nJunk/other: ${(out.junk_email_ids||[]).join(', ')}`);
  console.log(`\nGemma summary: ${out.summary||''}`);
}

main().catch(e=>{console.error(`TEST BLOCKED: ${e.message}`);process.exitCode=1;});
