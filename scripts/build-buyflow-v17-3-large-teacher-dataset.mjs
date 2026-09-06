import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(process.cwd(), 'training', 'v17-3-large');
const SEED = 17032026;
const SYSTEM = 'Analyze the commerce email from its actual meaning and evidence. Do not invent facts or links. Return only the requested JSON.';

const TRAIN_COUNTS = {
  ORDER_CREATED: 180,
  ORDER_PROCESSING: 180,
  PAYMENT: 160,
  INVOICE: 160,
  SHIPMENT_CREATED: 360,
  SHIPPED: 360,
  IN_TRANSIT: 300,
  OUT_FOR_DELIVERY: 300,
  READY_FOR_PICKUP: 180,
  DELIVERED: 180,
  CANCELLED: 140,
  REFUNDED: 140,
  RETURN: 120,
  OTHER: 240,
};

const VAL_COUNTS = {
  ORDER_CREATED: 25,
  ORDER_PROCESSING: 25,
  PAYMENT: 20,
  INVOICE: 20,
  SHIPMENT_CREATED: 50,
  SHIPPED: 50,
  IN_TRANSIT: 40,
  OUT_FOR_DELIVERY: 40,
  READY_FOR_PICKUP: 25,
  DELIVERED: 25,
  CANCELLED: 20,
  REFUNDED: 20,
  RETURN: 15,
  OTHER: 25,
};

const ALLOWED_EVENTS = new Set(Object.keys(TRAIN_COUNTS));
const ALLOWED_PERSPECTIVES = new Set(['buyer', 'merchant_outbound', 'non_purchase']);
const ALLOWED_LINK = new Set(['linked', 'unresolved', 'not_applicable']);

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
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Text(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJsonl(p, rows) { fs.writeFileSync(p, rows.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8'); }

const merchants = [
  ['Decathlon', 'decathlon.hu'], ['About You', 'aboutyou.hu'], ['Notino', 'notino.hu'],
  ['Dorko', 'dorko.hu'], ['MediaMarkt', 'mediamarkt.hu'], ['eMAG', 'emag.hu'],
  ['Pepita', 'pepita.hu'], ['Alza', 'alza.hu'], ['GymBeam', 'gymbeam.hu'],
  ['iPon', 'ipon.hu'], ['Reserved', 'reserved.com'], ['Mömax', 'moemax.hu'],
  ['Euronics', 'euronics.hu'], ['Rossmann', 'rossmann.hu'], ['Douglas', 'douglas.hu'],
  ['BestByte', 'bestbyte.hu'], ['JátékNet', 'jateknet.hu'], ['Bookline', 'bookline.hu'],
  ['Kifli', 'kifli.hu'], ['Vision Express', 'visionexpress.hu'], ['Sinsay', 'sinsay.com'],
  ['Hervis', 'hervis.hu'], ['Aqua', 'aqua.hu'], ['Libri', 'libri.hu'],
];
const carriers = [
  ['GLS', 'GLS'], ['MPL', 'MPL'], ['Foxpost', 'FOX'], ['Packeta', 'PKT'],
  ['DPD', 'DPD'], ['Express One', 'EO'], ['Sameday', 'SDY'], ['UPS', 'UPS'],
];
const products = [
  'parfüm', 'sportcipő', 'robotporszívó', 'fejhallgató', 'gyerekjáték', 'pulóver',
  'vitamin', 'kávéfőző', 'telefon tok', 'túrabakancs', 'könyv', 'monitor',
  'hajszárító', 'lego készlet', 'futócipő', 'konyhai robotgép', 'hátizsák', 'óra',
];

const phrases = {
  train: {
    ORDER_CREATED: [
      'A rendelésed sikeresen beérkezett és rögzítettük rendszerünkben.',
      'Köszönjük a vásárlást, megrendelésedet fogadtuk.',
      'A rendelési igény rögzítése megtörtént.',
      'Megrendelésed visszaigazolva, feldolgozása hamarosan megkezdődik.',
      'A vásárlás leadása sikeres volt, rendelési azonosítód érvényes.',
      'A rendelést fogadtuk; ez még nem jelent csomagfeladást.',
    ],
    ORDER_PROCESSING: [
      'A raktár megkezdte az összekészítést, futárnak még nem adtuk át.',
      'Rendelésed feldolgozás alatt áll, a csomagolás folyamatban van.',
      'A termékeket előkészítjük; fizikai feladás még nem történt.',
      'A rendelést a raktár feldolgozza, szállításra még nem került átadásra.',
      'Csomagoljuk a termékeket, a futár még nem vette át a küldeményt.',
      'A rendelés jelenleg előkészítés alatt van a feladói raktárban.',
    ],
    PAYMENT: [
      'A bankkártyás fizetés sikeresen lezárult.',
      'A tranzakció jóváhagyva, az összeg beérkezett.',
      'Sikeres online fizetés történt.',
      'A fizetési szolgáltató elfogadta a tranzakciót.',
      'A vásárlás ellenértékét sikeresen kifizetted.',
      'A tranzakció státusza: sikeres.',
    ],
    INVOICE: [
      'Elektronikus számláját elkészítettük.',
      'A számla kiállításra került.',
      'Az e-számla elkészült és letölthető.',
      'A vásárláshoz tartozó számladokumentum elérhető.',
      'Számláját sikeresen kiállítottuk.',
      'A rendelésről készült számla megnyitható.',
    ],
    SHIPMENT_CREATED: [
      'A fuvarozónak elektronikus adatot küldtünk, de a csomag még nálunk van.',
      'A címke elkészült; a futár fizikailag még nem vette át a küldeményt.',
      'Előzetes csomagadat rögzítve, tényleges átadás még nem történt.',
      'A szállítási megbízást létrehoztuk, a doboz továbbra is a feladónál van.',
      'A csomagszám létrejött, de a küldeményt még nem adták át a fuvarozónak.',
      'A futár rendszerében megjelent a küldemény adata, fizikai átvétel nélkül.',
      'Elektronikus előértesítés történt; a csomag még a webshop raktárában van.',
      'Shipping label created. The parcel has not been collected by the carrier yet.',
    ],
    SHIPPED: [
      'A csomagot fizikailag átadtuk a futárnak.',
      'A fuvarozó átvette a küldeményt a feladótól.',
      'A csomag elhagyta a raktárt, átadtuk a szállító partnernek.',
      'A futár a feladótól ténylegesen átvette a csomagot.',
      'A küldeményt átadták a szállítónak, megkezdődhet a továbbítás.',
      'A feladó raktárából a fuvarozó elszállította a csomagot.',
      'Carrier pickup completed: the parcel was collected from the sender.',
      'A csomagot a futár átvette, már nincs a kereskedő raktárában.',
    ],
    IN_TRANSIT: [
      'A küldemény két depó között továbbítás alatt van.',
      'A csomag a szállítási hálózatban halad a következő központ felé.',
      'A küldeményt a regionális depóból továbbították.',
      'A csomag elhagyta az egyik feldolgozóközpontot és úton van a következőbe.',
      'A küldemény a fuvarozó hálózatán belül mozog.',
      'Transit scan recorded at a carrier hub; delivery vehicle assignment has not happened yet.',
      'A csomag depóközi szállításban van, kézbesítő futárhoz még nem került.',
    ],
    OUT_FOR_DELIVERY: [
      'A csomag a kézbesítő járművén van, ma érkezik.',
      'A futárnál van a küldemény, a kézbesítés a mai napon várható.',
      'A mai kézbesítési körre kiadtuk a csomagot a futárnak.',
      'A küldeményt a helyi futár kézbesítésre átvette, ma viszi a címre.',
      'A csomag a kézbesítőnél van és a mai útvonalán szerepel.',
      'Out for delivery: the parcel is on the courier vehicle today.',
      'A helyi depóból kézbesítésre kiadták, várható érkezés ma.',
    ],
    READY_FOR_PICKUP: [
      'A csomag megérkezett az automatába és átvehető.',
      'A küldemény az átvételi ponton vár, mostantól átvehető.',
      'Az átvételi kód aktív, a csomag a rekeszben van.',
      'A csomagot elhelyeztük a kiválasztott csomagautomatában.',
      'A küldemény átvehető a megadott partnerponton.',
      'Ready for pickup: the parcel is waiting in the locker.',
    ],
    DELIVERED: [
      'A címzett a küldeményt sikeresen átvette.',
      'A kézbesítés megtörtént, a csomagot átadtuk a címzettnek.',
      'Kézbesítve: az átvétel sikeres volt.',
      'A futár sikeresen kézbesítette a küldeményt a címzettnek.',
      'A csomag átadása lezárult, a címzett átvette.',
      'Delivered successfully to the recipient.',
    ],
    CANCELLED: [
      'A rendelést töröltük, nem kerül kiszállításra.',
      'A megrendelés megszüntetésre került.',
      'A rendelést kérésedre töröltük.',
      'A rendelés teljesítése meghiúsult, ezért véglegesen töröltük.',
      'A rendelés státusza törölt, kiszállítás nem lesz.',
    ],
    REFUNDED: [
      'A visszatérítést teljesítettük az eredeti fizetési módra.',
      'Az összeget sikeresen visszautaltuk.',
      'A refund lezárult, a pénz visszatérítésre került.',
      'A visszafizetés feldolgozása befejeződött.',
      'A rendelés ellenértékét visszatérítettük.',
    ],
    RETURN: [
      'A visszaküldött terméket átvettük feldolgozásra.',
      'A visszáru beérkezett a raktárba.',
      'A visszaküldési folyamat aktív, a csomagot átvettük.',
      'A visszaküldött küldemény beérkezett és ellenőrzésre vár.',
      'Return parcel received by the warehouse.',
    ],
  },
  val: {
    ORDER_CREATED: [
      'Megrendelésed fogadva, a rendelési hivatkozás alább szerepel.',
      'We received your order and created the purchase record.',
      'A rendelés leadása megtörtént; szállítás még nem indult.',
    ],
    ORDER_PROCESSING: [
      'A rendelés raktári előkészítés alatt áll; átadás a fuvarozónak még nincs.',
      'Warehouse processing is in progress and the carrier has not collected the parcel.',
      'A termékeket csomagolják, a küldemény még a feladónál van.',
    ],
    PAYMENT: [
      'Payment approved successfully for this order.',
      'A fizetési tranzakciót a szolgáltató sikeresként zárta le.',
      'Az ellenérték beérkezett, a fizetés teljesült.',
    ],
    INVOICE: [
      'Invoice document issued for your purchase.',
      'A vásárlási számla elkészült és elérhető.',
      'A rendeléshez tartozó e-számlát kiállították.',
    ],
    SHIPMENT_CREATED: [
      'Shipment information was transmitted, but the parcel remains with the sender.',
      'A fuvarozó csak elektronikus előértesítést kapott; fizikai átvétel nem történt.',
      'Tracking number assigned, carrier pickup still pending.',
      'A címke létrejött, de a csomag még nem hagyta el a feladó telephelyét.',
    ],
    SHIPPED: [
      'The carrier physically collected the parcel from the merchant.',
      'A csomagot a szállító partner ténylegesen átvette a feladótól.',
      'Carrier handoff complete; the parcel left the sender warehouse.',
      'A futár elszállította a csomagot a kereskedőtől.',
    ],
    IN_TRANSIT: [
      'The parcel is moving between carrier hubs and is not yet out for delivery.',
      'A küldemény a logisztikai hálózatban halad a következő depóba.',
      'Hub transfer in progress; local courier delivery has not started.',
    ],
    OUT_FOR_DELIVERY: [
      'The local courier has the parcel on today’s delivery route.',
      'A csomagot a mai kézbesítési körre kiadták a futárnak.',
      'Courier vehicle scan completed; delivery is expected today.',
    ],
    READY_FOR_PICKUP: [
      'Your parcel is ready for collection at the selected locker.',
      'A küldemény átvehetővé vált az átvételi ponton.',
      'Locker placement completed; pickup code is active.',
    ],
    DELIVERED: [
      'Recipient handoff completed successfully.',
      'A küldeményt a címzett átvette, kézbesítés lezárva.',
      'Delivery completed and signed/accepted by the recipient.',
    ],
    CANCELLED: [
      'Order cancelled permanently; no shipment will follow.',
      'A rendelést végleg megszüntették, teljesítés nem lesz.',
      'Cancellation completed for this order.',
    ],
    REFUNDED: [
      'Refund completed to the original payment method.',
      'A visszafizetés teljesült, az összeget visszaküldték.',
      'Refund settlement finished successfully.',
    ],
    RETURN: [
      'Returned parcel received for warehouse processing.',
      'A visszáru megérkezett és feldolgozásra vár.',
      'Return shipment accepted by the merchant warehouse.',
    ],
  },
};

const subjects = {
  ORDER_CREATED: ['Rendelés visszaigazolása', 'Megrendelés fogadva', 'Order received'],
  ORDER_PROCESSING: ['Rendelés feldolgozás alatt', 'Csomagolás folyamatban', 'Order processing'],
  PAYMENT: ['Sikeres fizetés', 'Fizetési visszaigazolás', 'Payment confirmed'],
  INVOICE: ['Elektronikus számla', 'Számla elkészült', 'Invoice issued'],
  SHIPMENT_CREATED: ['Küldeményadat létrehozva', 'Címke elkészült', 'Shipment information received'],
  SHIPPED: ['Csomag feladva', 'Futárnak átadva', 'Parcel collected'],
  IN_TRANSIT: ['Küldemény továbbítás alatt', 'Csomag úton', 'In transit'],
  OUT_FOR_DELIVERY: ['Kézbesítés ma', 'Futárnál a csomag', 'Out for delivery'],
  READY_FOR_PICKUP: ['Csomag átvehető', 'Átvételi értesítés', 'Ready for pickup'],
  DELIVERED: ['Sikeres kézbesítés', 'Kézbesítve', 'Delivered'],
  CANCELLED: ['Rendelés törölve', 'Megrendelés megszüntetve', 'Order cancelled'],
  REFUNDED: ['Visszatérítés teljesítve', 'Összeg visszautalva', 'Refund completed'],
  RETURN: ['Visszaküldés', 'Visszáru beérkezett', 'Return received'],
};

function ids(i, split) {
  const [merchant, domain] = pick(merchants);
  const [carrier, prefix] = pick(carriers);
  const base = split === 'train' ? 730000 : 930000;
  const stem = merchant.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ORD';
  return {
    merchant, domain, carrier,
    order: `${stem}-${base + i}`,
    tracking: `${prefix}${880000000 + (split === 'train' ? i : 50000 + i)}`,
    product: pick(products),
  };
}

function email(from, subject, body) {
  return `Feladó: ${from}\nTárgy: ${subject}\n\n${body}`;
}
function target(event_type, perspective, order_id, tracking_id, link_status, evidence) {
  return { event_type, perspective, order_id, tracking_id, link_status, evidence };
}
function row(id, input, answer, tags) {
  return {
    id,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Elemezd ezt az e-mailt BuyFlow szerint. Adj vissza JSON-t ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status, evidence.\n\n${input}` },
      { role: 'assistant', content: JSON.stringify(answer) },
    ],
    meta: tags,
  };
}

function decorate(text, label, i, split) {
  const variants = [
    t => t,
    t => `Megtekintés böngészőben | automatikus üzenet\n\n${t}\n\nKérjük, erre az e-mailre ne válaszolj.`,
    t => `${t}\n\n--- Rendszerinformáció ---\nÉrtesítés generálva: 2026-${String((i % 9) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')} 14:${String(i % 60).padStart(2, '0')}`,
    t => `${t}\n\nÜgyfélszolgálat | Adatkezelés | Leiratkozás`,
    t => `Online változat\n${t.replace(/\n\n/g, '\n')}\nAutomatikus értesítő rendszer`,
  ];
  let out = variants[i % variants.length](text);
  if (i % 9 === 0) {
    const older = label === 'OUT_FOR_DELIVERY'
      ? 'Korábbi állapot: a küldemény depók között továbbítás alatt volt.'
      : label === 'SHIPPED'
        ? 'Korábbi állapot: a szállítási címke elkészült, a futár még nem vette át.'
        : label === 'DELIVERED'
          ? 'Korábbi állapot: a csomag kézbesítésre kiadva.'
          : 'Korábbi automatikus értesítés: rendelés feldolgozása folyamatban.';
    out += `\n\n--- Korábbi idézett üzenet ---\n${older}`;
  }
  if (split === 'val' && i % 6 === 0) out = `Message-ID: <v17-${i}@mail.example>\n${out}`;
  return out;
}

function linkVariant(x, i) {
  const v = i % 5;
  if (v === 0) {
    return { prefix: `Rendelés: ${x.order}\nCsomagszám: ${x.tracking}\n`, order: x.order, status: 'linked', tag: 'exact-order-tracking' };
  }
  if (v === 1) {
    return { prefix: `Csomagszám: ${x.tracking}\n`, order: null, status: 'unresolved', tag: 'tracking-only-unresolved' };
  }
  if (v === 2) {
    return { prefix: `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\nCsomagszám: ${x.tracking}\n`, order: x.order, status: 'linked', tag: 'verified-context' };
  }
  if (v === 3) {
    const alt = `ALT-${810000 + i}`;
    return { prefix: `Lehetséges rendelések: ${x.order} vagy ${alt}. Nincs igazolt hozzárendelés.\nCsomagszám: ${x.tracking}\n`, order: null, status: 'unresolved', tag: 'ambiguous-order' };
  }
  return { prefix: `Rendelési hivatkozás: ${x.order}\nCsomagszám: ${x.tracking}\n`, order: x.order, status: 'linked', tag: 'explicit-order-tracking' };
}

function orderSender(label, x) {
  if (label === 'PAYMENT') return pick(['noreply@simplepay.hu', 'notification@barion.com', 'payments@pay.example']);
  if (label === 'INVOICE') return pick(['noreply@billingo.hu', 'szamla@szamlazz.hu', 'invoice@billing.example']);
  if (['CANCELLED', 'REFUNDED', 'RETURN'].includes(label)) return `service@${x.domain}`;
  return pick([`noreply@${x.domain}`, `order@${x.domain}`, `shop@${x.domain}`]);
}

function makeLifecycle(label, i, split) {
  const x = ids(i, split);
  const phrase = pick(phrases[split][label]);
  const subject = `${pick(subjects[label])}${i % 4 === 0 ? ` – ${x.order}` : ''}`;

  if (['ORDER_CREATED', 'ORDER_PROCESSING', 'PAYMENT', 'INVOICE', 'CANCELLED', 'REFUNDED', 'RETURN'].includes(label)) {
    let body = `Rendelés: ${x.order}\nTermék: ${x.product}\n${phrase}`;
    if (label === 'PAYMENT') body = `Kereskedő: ${x.merchant}\nRendelési hivatkozás: ${x.order}\nTranzakció: TX-${910000 + i}\n${phrase}`;
    if (label === 'INVOICE') body = `Eladó: ${x.merchant}\nRendelési hivatkozás: ${x.order}\nSzámlaszám: INV-2026-${70000 + i}\n${phrase}`;
    if (i % 8 === 0) body += `\nÜgyfélhivatkozás: REF-${400000 + i}`;
    const input = decorate(email(orderSender(label, x), subject, body), label, i, split);
    return row('', input, target(label, 'buyer', x.order, null, 'linked', phrase), ['v17.3', split, `event:${label.toLowerCase()}`]);
  }

  const lv = linkVariant(x, i);
  const sender = ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED'].includes(label)
    ? pick(['status@carrier.example', 'tracking@parcel.example', 'info@delivery.example'])
    : `shipping@${x.domain}`;
  let body = `${lv.prefix}${phrase}`;
  if (i % 7 === 0) body += `\nFuvarozó: ${x.carrier}`;
  if (i % 13 === 0) body += `\nÜgyfélszolgálati azonosító: CASE-${500000 + i}`;
  const input = decorate(email(sender, subject, body), label, i, split);
  return row('', input, target(label, 'buyer', lv.order, x.tracking, lv.status, phrase), ['v17.3', split, lv.tag, `boundary:${label.toLowerCase()}`]);
}

function makeOther(i, split) {
  const x = ids(i, split);
  const v = i % 8;
  if (v === 0 || v === 1) {
    const text = split === 'train'
      ? pick([
          'Tisztelt Webshop Partner! Futárunk ma érkezik az Ön telephelyére a vásárlóinak feladandó csomagok átvételére.',
          'A mai napon begyűjtjük az Ön által vevőinek feladandó küldeményeket.',
          'A futár a feladói raktárból veszi át az Ön webshopja által előkészített csomagokat.',
          'Partner pickup: prepare the parcels your shop is sending to customers for carrier collection.',
        ])
      : pick([
          'Merchant pickup notice: our courier will collect parcels your store is sending to customers.',
          'Webshop partner értesítés: a futár az Ön feladandó vevői csomagjaiért érkezik.',
          'A fuvarozó partnercsomagokat gyűjt be az Ön telephelyéről; ez nem saját vásárlás.',
        ]);
    return row('', email('pickup@carrier.example', 'Partner csomagfelvétel', text), target('OTHER', 'merchant_outbound', null, null, 'not_applicable', text), ['v17.3', split, 'merchant_outbound']);
  }
  if (v === 2) {
    const text = split === 'train'
      ? `Csak ma: -25% a kijelölt termékekre. Kuponkód: GLS${990123000 + i}. Ez promóciós kód, nem csomagszám.`
      : `Weekend sale: use code EO${880100000 + i}; this is a coupon, not parcel tracking.`;
    return row('', email(`promo@${x.domain}`, 'Akció és kupon', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'marketing', 'fake-id']);
  }
  if (v === 3) {
    const text = split === 'train'
      ? 'Új eszközről történt bejelentkezés a fiókodba. Ha nem te voltál, módosíts jelszót.'
      : 'Security alert: a new device signed in to your account. Review account access.';
    return row('', email(`security@${x.domain}`, 'Biztonsági értesítés', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'security']);
  }
  if (v === 4) {
    const text = split === 'train'
      ? `Mennyire voltál elégedett a ${x.tracking} csomag kézbesítésével? Töltsd ki kérdőívünket.`
      : `Please rate the delivery experience for parcel ${x.tracking}.`;
    const context = `Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n`;
    return row('', `${context}${email('survey@carrier.example', 'Értékeld a kézbesítést', text)}`, target('OTHER', 'non_purchase', x.order, x.tracking, 'linked', text), ['v17.3', split, 'survey', 'related-non-lifecycle']);
  }
  if (v === 5) {
    const text = split === 'train'
      ? `A ${x.tracking} küldemény értesítési nyelvét módosíthatod. Ez nem csomagállapot-változás.`
      : `Notification preferences for ${x.tracking} can be changed; parcel status is unchanged.`;
    return row('', email('settings@carrier.example', 'Értesítési beállítások', text), target('OTHER', 'non_purchase', null, x.tracking, 'not_applicable', text), ['v17.3', split, 'settings', 'tracking-no-lifecycle']);
  }
  if (v === 6) {
    const text = split === 'train'
      ? `Jelszó-visszaállítási kód: ${100000 + (i % 899999)}. A kód 10 percig érvényes.`
      : `Your one-time account verification code is ${100000 + (i % 899999)}.`;
    return row('', email(`account@${x.domain}`, 'Fiókellenőrzés', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'account']);
  }
  const text = split === 'train'
    ? `Hírlevél: új ${x.product} érkezett. Rendelési példakód: ORD-${600000 + i}, amely csak kampányazonosító.`
    : `Newsletter announcement with campaign reference ORD-${600000 + i}; no purchase event occurred.`;
  return row('', email(`news@${x.domain}`, 'Újdonságok', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'newsletter', 'fake-order-id']);
}

function buildSplit(counts, split) {
  const rows = [];
  let serial = split === 'train' ? 1 : 100001;
  for (const [label, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const r = label === 'OTHER' ? makeOther(serial + i, split) : makeLifecycle(label, serial + i, split);
      r.id = `${split === 'train' ? 'v17-3-tr' : 'v17-3-va'}-${String(serial + i).padStart(6, '0')}`;
      rows.push(r);
    }
    serial += count + 17;
  }
  return shuffle(rows);
}

function validateRows(rows, expected, split) {
  if (rows.length !== expected) throw new Error(`${split}: expected ${expected} rows, got ${rows.length}`);
  const ids = new Set();
  const inputs = new Set();
  const dist = {};
  let linked = 0, unresolved = 0, notApplicable = 0;
  for (const r of rows) {
    if (!r.id || ids.has(r.id)) throw new Error(`${split}: duplicate/missing id ${r.id}`);
    ids.add(r.id);
    if (!Array.isArray(r.messages) || r.messages.length !== 3) throw new Error(`${split}: bad messages in ${r.id}`);
    const user = r.messages.find(m => m.role === 'user')?.content;
    const answerText = r.messages.find(m => m.role === 'assistant')?.content;
    if (!user || !answerText) throw new Error(`${split}: missing user/assistant in ${r.id}`);
    if (inputs.has(user)) throw new Error(`${split}: exact duplicate user input in ${r.id}`);
    inputs.add(user);
    let a;
    try { a = JSON.parse(answerText); } catch { throw new Error(`${split}: invalid assistant JSON in ${r.id}`); }
    if (!ALLOWED_EVENTS.has(a.event_type)) throw new Error(`${split}: bad event_type in ${r.id}`);
    if (!ALLOWED_PERSPECTIVES.has(a.perspective)) throw new Error(`${split}: bad perspective in ${r.id}`);
    if (!ALLOWED_LINK.has(a.link_status)) throw new Error(`${split}: bad link_status in ${r.id}`);
    for (const k of ['event_type', 'perspective', 'order_id', 'tracking_id', 'link_status', 'evidence']) {
      if (!(k in a)) throw new Error(`${split}: missing ${k} in ${r.id}`);
    }
    dist[a.event_type] = (dist[a.event_type] || 0) + 1;
    if (a.link_status === 'linked') linked++;
    else if (a.link_status === 'unresolved') unresolved++;
    else notApplicable++;
  }
  return { dist, linked, unresolved, not_applicable: notApplicable, unique_inputs: inputs.size };
}

ensureDir(OUT);
const train = buildSplit(TRAIN_COUNTS, 'train');
const validation = buildSplit(VAL_COUNTS, 'val');
const trainStats = validateRows(train, 3000, 'train');
const valStats = validateRows(validation, 400, 'validation');

const trainFile = path.join(OUT, 'train.jsonl');
const valFile = path.join(OUT, 'validation.jsonl');
writeJsonl(trainFile, train);
writeJsonl(valFile, validation);

const trainSha = sha256File(trainFile);
const valSha = sha256File(valFile);
const corpusFingerprint = sha256Text(`${trainSha}\n${valSha}\n${SEED}\n`);
const manifest = {
  dataset: 'buyflow-v17-3-large-teacher',
  seed: SEED,
  train_rows: train.length,
  validation_rows: validation.length,
  external_blind_v2_read: false,
  external_blind_v2_modified: false,
  purpose: 'large diverse QLoRA continuation corpus after V17 initial 240-row proof-of-learning run',
  prompt_style: 'minimal BuyFlow JSON task instruction; semantics are in supervised examples',
  train_sha256: trainSha,
  validation_sha256: valSha,
  corpus_fingerprint: corpusFingerprint,
  train_distribution: trainStats.dist,
  validation_distribution: valStats.dist,
  train_link_status: { linked: trainStats.linked, unresolved: trainStats.unresolved, not_applicable: trainStats.not_applicable },
  validation_link_status: { linked: valStats.linked, unresolved: valStats.unresolved, not_applicable: valStats.not_applicable },
  train_unique_inputs: trainStats.unique_inputs,
  validation_unique_inputs: valStats.unique_inputs,
  notes: [
    'Validation uses separate phrasing banks from training.',
    'Hard lifecycle boundaries are intentionally overweighted.',
    'Includes noisy/quoted/footer variants, English/Hungarian phrasing, ambiguous linking, fake IDs, marketplace-like provider mail patterns and merchant-outbound operational mail.',
    'External Blind V2 is not read or modified by this builder.',
  ],
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('==============================================================');
console.log('BUYFLOW V17.3 LARGE TEACHER DATASET READY');
console.log(`Output: ${OUT}`);
console.log(`Train: ${train.length}`);
console.log(`Validation: ${validation.length}`);
console.log(`Train unique inputs: ${trainStats.unique_inputs}/${train.length}`);
console.log(`Validation unique inputs: ${valStats.unique_inputs}/${validation.length}`);
console.log(`train sha256:      ${trainSha}`);
console.log(`validation sha256: ${valSha}`);
console.log(`corpus fingerprint: ${corpusFingerprint}`);
console.log('External Blind V2: NOT READ / NOT MODIFIED');
console.log('Training: NOT STARTED');
console.log('Production: OFF');
console.log('==============================================================');
