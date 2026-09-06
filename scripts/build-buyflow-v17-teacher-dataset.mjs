import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(process.cwd(), 'training', 'v17', 'generated');
const SEED = 17012026;
const SYSTEM = 'Analyze the commerce email from its actual meaning and evidence. Do not invent facts or links. Return the requested JSON.';

let state = SEED >>> 0;
function rnd() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
}
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function pad(n) { return String(n).padStart(5, '0'); }

const merchants = [
  ['Decathlon', 'decathlon.hu'], ['About You', 'aboutyou.hu'], ['Notino', 'notino.hu'],
  ['Dorko', 'dorko.hu'], ['MediaMarkt', 'mediamarkt.hu'], ['eMAG', 'emag.hu'],
  ['Pepita', 'pepita.hu'], ['Alza', 'alza.hu'], ['GymBeam', 'gymbeam.hu']
];
const carriers = [
  ['GLS', 'GLS'], ['MPL', 'MPL'], ['Foxpost', 'FOX'], ['Packeta', 'PKT'],
  ['DPD', 'DPD'], ['Express One', 'EO']
];
const products = ['parfüm', 'sportcipő', 'kávéfőző', 'túracipő', 'fejhallgató', 'gyerekjáték', 'pulóver', 'vitamin', 'porszívó'];

function ids(i) {
  const [merchant, domain] = pick(merchants);
  const [carrier, prefix] = pick(carriers);
  const order = `${merchant.replace(/[^A-Za-z]/g, '').slice(0,3).toUpperCase()}-${620000 + i}`;
  const tracking = `${prefix}${880000000 + i}`;
  return { merchant, domain, carrier, order, tracking, product: pick(products) };
}

function email(from, subject, body) { return `Feladó: ${from}\nTárgy: ${subject}\n\n${body}`; }
function target(event_type, perspective, order_id, tracking_id, link_status, evidence) {
  return { event_type, perspective, order_id, tracking_id, link_status, evidence };
}
function row(id, input, answer, tags) {
  return {
    id,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Elemezd ezt az e-mailt BuyFlow szerint. Adj vissza JSON-t ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status, evidence.\n\n${input}` },
      { role: 'assistant', content: JSON.stringify(answer) }
    ],
    meta: tags
  };
}

const makers = {
  ORDER_CREATED(i) {
    const x = ids(i); const phrase = pick(['A rendelésed sikeresen beérkezett.', 'Köszönjük, megrendelésedet rögzítettük.', 'Rendelésedet fogadtuk és hamarosan feldolgozzuk.']);
    return row('', email(`noreply@${x.domain}`, `Rendelés visszaigazolása – ${x.order}`, `Rendelési szám: ${x.order}\nTermék: ${x.product}\n${phrase}`), target('ORDER_CREATED','buyer',x.order,null,'linked',`Rendelési szám: ${x.order}`), ['order']);
  },
  ORDER_PROCESSING(i) {
    const x = ids(i); const phrase = pick(['A termékeket összekészítjük. A futárnak még nem adtuk át.', 'Rendelésed feldolgozás alatt van, csomagolása folyamatban.', 'A raktár megkezdte a rendelés összekészítését.']);
    return row('', email(`order@${x.domain}`, `Rendelés feldolgozás alatt – ${x.order}`, `Rendelés: ${x.order}\n${phrase}`), target('ORDER_PROCESSING','buyer',x.order,null,'linked',phrase), ['processing']);
  },
  PAYMENT(i) {
    const x = ids(i); const tx = `TX-${910000+i}`;
    return row('', email('noreply@simplepay.hu','Sikeres fizetés',`Kereskedő: ${x.merchant}\nRendelési hivatkozás: ${x.order}\nTranzakció: ${tx}\nA fizetés sikeresen megtörtént.`), target('PAYMENT','buyer',x.order,null,'linked',`Rendelési hivatkozás: ${x.order}`), ['payment']);
  },
  INVOICE(i) {
    const x = ids(i); const inv = `INV-2026-${70000+i}`;
    return row('', email('noreply@billingo.hu','Elektronikus számla',`Eladó: ${x.merchant}\nRendelési hivatkozás: ${x.order}\nSzámlaszám: ${inv}`), target('INVOICE','buyer',x.order,null,'linked',`Rendelési hivatkozás: ${x.order}`), ['invoice']);
  },
  SHIPMENT_CREATED(i) {
    const x = ids(i); const explicitOrder = i % 4 !== 0;
    const phrases = [
      `A ${x.carrier} részére elektronikus csomagadatot hoztunk létre. A csomag még raktárunkban van, a futár nem vette át.`,
      `A szállítási címke elkészült. ${x.carrier} még nem vette át fizikailag a küldeményt.`,
      `A küldemény adatait továbbítottuk a fuvarozónak, de a csomag átadása még nem történt meg.`
    ];
    const p = pick(phrases);
    const body = `${explicitOrder ? `Rendelés: ${x.order}\n` : ''}Csomagszám: ${x.tracking}\n${p}`;
    return row('', email(`shipping@${x.domain}`,'Küldeményadat létrehozva',body), target('SHIPMENT_CREATED','buyer',explicitOrder?x.order:null,x.tracking,explicitOrder?'linked':'unresolved',p), ['boundary:pre_advice','shipment', explicitOrder?'linked':'unresolved']);
  },
  SHIPPED(i) {
    const x = ids(i); const explicitOrder = i % 5 !== 0;
    const p = pick([`A csomagot átadtuk a ${x.carrier} futárnak.`,`A ${x.carrier} a küldeményt a feladótól fizikailag átvette.`,`A csomagot a fuvarozó részére átadtuk, elhagyta raktárunkat.`]);
    const context = !explicitOrder && i % 2 === 0 ? `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n` : '';
    const status = explicitOrder || context ? 'linked' : 'unresolved';
    const order = explicitOrder || context ? x.order : null;
    const body = `${explicitOrder ? `Rendelés: ${x.order}\n` : ''}Csomagszám: ${x.tracking}\n${p}`;
    return row('', `${context}${email(`info@${x.domain}`,'Csomag feladva',body)}`, target('SHIPPED','buyer',order,x.tracking,status,p), ['boundary:physical_handoff','shipment',status]);
  },
  IN_TRANSIT(i) {
    const x = ids(i); const context = i % 3 !== 0 ? `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n` : '';
    const p = pick(['A csomag elhagyta a központi depót és a helyi depó felé tart.','A küldemény a szállítási hálózatban továbbítás alatt van.','A csomag a következő feldolgozóközpont felé halad.']);
    return row('', `${context}${email(`info@carrier.example`,'Küldemény továbbítva',`Csomagszám: ${x.tracking}\n${p}`)}`, target('IN_TRANSIT','buyer',context?x.order:null,x.tracking,context?'linked':'unresolved',p), ['boundary:network_movement','shipment',context?'linked':'unresolved']);
  },
  OUT_FOR_DELIVERY(i) {
    const x = ids(i); const context = i % 4 !== 0 ? `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n` : '';
    const p = pick(['A küldemény a kézbesítő járművén van, ma kézbesítjük.','A futárnál van a csomag, kézbesítés ma 12:00 és 16:00 között várható.','A csomagot a mai kézbesítési körre kiadtuk a futárnak.']);
    return row('', `${context}${email('info@carrier.example','Kézbesítés ma',`Csomagszám: ${x.tracking}\n${p}`)}`, target('OUT_FOR_DELIVERY','buyer',context?x.order:null,x.tracking,context?'linked':'unresolved',p), ['boundary:last_mile','shipment',context?'linked':'unresolved']);
  },
  READY_FOR_PICKUP(i) {
    const x = ids(i); const context = `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n`;
    const p = pick(['A csomagot elhelyeztük a kiválasztott automatában, mostantól átvehető.','Küldeményed megérkezett az átvételi pontra és átvehető.','A csomag a csomagautomatában vár, az átvételi kód érvényes.']);
    return row('', `${context}${email('no-reply@locker.example','Csomag átvehető',`Csomagszám: ${x.tracking}\n${p}`)}`, target('READY_FOR_PICKUP','buyer',x.order,x.tracking,'linked',p), ['boundary:pickup_ready']);
  },
  DELIVERED(i) {
    const x = ids(i); const context = `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n`;
    const p = pick(['A küldeményt sikeresen átadtuk a címzettnek.','A csomag kézbesítése 14:36-kor sikeresen megtörtént.','Kézbesítve: a címzett átvette a küldeményt.']);
    return row('', `${context}${email('info@carrier.example','Sikeres kézbesítés',`Csomagszám: ${x.tracking}\n${p}`)}`, target('DELIVERED','buyer',x.order,x.tracking,'linked',p), ['boundary:delivered']);
  },
  CANCELLED(i) {
    const x = ids(i); const p = pick(['A rendelést készlethiány miatt töröltük.','Kérésedre a rendelést töröltük, nem kerül kiszállításra.','A rendelés teljesítése meghiúsult, ezért törlésre került.']);
    return row('', email(`order@${x.domain}`,'Rendelés törölve',`Rendelés: ${x.order}\n${p}`), target('CANCELLED','buyer',x.order,null,'linked',p), ['cancel']);
  },
  REFUNDED(i) {
    const x = ids(i); const p = pick(['A visszatérítés sikeresen megtörtént az eredeti fizetési módra.','Az összeget visszautaltuk, a refund lezárult.','A rendelés teljes összege sikeresen visszatérítésre került.']);
    return row('', email(`payments@${x.domain}`,'Visszatérítés teljesítve',`Rendelés: ${x.order}\n${p}`), target('REFUNDED','buyer',x.order,null,'linked',p), ['refund:settled']);
  },
  RETURN(i) {
    const x = ids(i); const p = pick(['A visszaküldött csomagot raktárunk átvette.','A termék visszaküldése folyamatban van, a visszáru azonosítót rögzítettük.','A visszáru küldeményt átvettük feldolgozásra.']);
    return row('', email(`returns@${x.domain}`,'Visszaküldés',`Rendelés: ${x.order}\n${p}`), target('RETURN','buyer',x.order,null,'linked',p), ['return']);
  },
  OTHER(i) {
    const x = ids(i);
    if (i % 5 < 2) {
      const p = pick(['Futárunk holnap érkezik az Ön telephelyére a vásárlóinak feladandó csomagok átvételére.','Tisztelt Webshop Partner! A mai napon begyűjtjük az Ön által feladandó küldeményeket.','A futár a feladói telephelyükön veszi át a vevők részére előkészített csomagokat.']);
      return row('', email('pickup@carrier.example','Partner csomagfelvétel',p), target('OTHER','merchant_outbound',null,null,'not_applicable',p), ['merchant_outbound']);
    }
    const kind = i % 3;
    if (kind === 0) {
      const p = 'Csak ma: válogass kedvezményes termékeink közül akár -30% kedvezménnyel.';
      return row('', email(`promo@${x.domain}`,'Mai akció',p), target('OTHER','non_purchase',null,null,'not_applicable',p), ['marketing']);
    }
    if (kind === 1) {
      const p = 'Új eszközről történt bejelentkezés a fiókodba. Ha nem te voltál, módosíts jelszót.';
      return row('', email(`security@${x.domain}`,'Biztonsági értesítés',p), target('OTHER','non_purchase',null,null,'not_applicable',p), ['security']);
    }
    const p = `Mennyire voltál elégedett a ${x.tracking} csomag kézbesítésével? Töltsd ki kérdőívünket.`;
    const context = `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n`;
    return row('', `${context}${email('survey@carrier.example','Értékeld a kézbesítést',p)}`, target('OTHER','non_purchase',x.order,x.tracking,'linked',p), ['survey','related_no_lifecycle']);
  }
};

const plan = [
  ['ORDER_CREATED',20], ['ORDER_PROCESSING',20], ['PAYMENT',15], ['INVOICE',15],
  ['SHIPMENT_CREATED',35], ['SHIPPED',35], ['IN_TRANSIT',25], ['OUT_FOR_DELIVERY',30],
  ['READY_FOR_PICKUP',20], ['DELIVERED',20], ['CANCELLED',15], ['REFUNDED',15],
  ['RETURN',10], ['OTHER',25]
];

let all = []; let n = 0;
for (const [label, count] of plan) {
  for (let i = 0; i < count; i++) {
    n++;
    const r = makers[label](n);
    r.id = `v17-${pad(n)}`;
    all.push(r);
  }
}
if (all.length !== 300) throw new Error(`Expected 300 examples, got ${all.length}`);
all = shuffle(all);

const splits = {
  train: all.slice(0, 240),
  validation: all.slice(240, 270),
  blind: all.slice(270, 300)
};

fs.mkdirSync(OUT, { recursive: true });
function writeJsonl(name, rows) {
  const text = rows.map(x => JSON.stringify(x)).join('\n') + '\n';
  const file = path.join(OUT, `${name}.jsonl`);
  fs.writeFileSync(file, text, 'utf8');
  return { file, sha256: crypto.createHash('sha256').update(text).digest('hex'), count: rows.length };
}
const files = {};
for (const [name, rows] of Object.entries(splits)) files[name] = writeJsonl(name, rows);

function counts(rows) {
  const c = {};
  for (const r of rows) {
    const a = JSON.parse(r.messages[2].content);
    c[a.event_type] = (c[a.event_type] || 0) + 1;
  }
  return c;
}
const manifest = {
  dataset: 'buyflow-v17-teacher-v1',
  seed: SEED,
  generated_at: new Date().toISOString(),
  total: all.length,
  split_policy: { train: 240, validation: 30, blind: 30 },
  files: Object.fromEntries(Object.entries(files).map(([k,v]) => [k,{count:v.count,sha256:v.sha256,file:path.basename(v.file)}])),
  label_counts: Object.fromEntries(Object.entries(splits).map(([k,v]) => [k,counts(v)])),
  warning: 'blind.jsonl is frozen. Do not train on it or tune prompts from it; if inspected for tuning, mark it spent and create a new blind seed.'
};
fs.writeFileSync(path.join(OUT,'manifest.json'), JSON.stringify(manifest,null,2)+'\n','utf8');

console.log('BUYFLOW V17 TEACHER DATASET READY');
console.log(`Output: ${OUT}`);
console.log('Train: 240');
console.log('Validation: 30');
console.log('Blind: 30 (FROZEN)');
console.log(`Seed: ${SEED}`);
for (const [k,v] of Object.entries(files)) console.log(`${k}: ${v.sha256}`);
