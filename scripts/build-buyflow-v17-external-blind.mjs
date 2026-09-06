import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(process.cwd(), 'evaluation', 'v17-external-blind');

const cases = [
  {id:'xb-001',input:`Feladó: webshop@reserved.com\nTárgy: Köszönjük a vásárlást\n\nRendelésszám: RS-310842\nA megrendelésed beérkezett rendszerünkbe.`,gold:{event_type:'ORDER_CREATED',perspective:'buyer',order_id:'RS-310842',tracking_id:null,link_status:'linked'}},
  {id:'xb-002',input:`Feladó: info@ipon.hu\nTárgy: Rendelés rögzítve #IP-77125\n\nA rendelésedet rögzítettük. Azonosító: IP-77125.`,gold:{event_type:'ORDER_CREATED',perspective:'buyer',order_id:'IP-77125',tracking_id:null,link_status:'linked'}},
  {id:'xb-003',input:`Feladó: order@ecipo.hu\nTárgy: Dolgozunk a rendeléseden\n\nRendelés EC-551820. A raktár megkezdte az áruk összeszedését. Futárnak még semmit nem adtunk át.`,gold:{event_type:'ORDER_PROCESSING',perspective:'buyer',order_id:'EC-551820',tracking_id:null,link_status:'linked'}},
  {id:'xb-004',input:`Feladó: shop@ikea.hu\nTárgy: Előkészítés alatt\n\nIKEA rendelés: IK-40219. A rendelés összeállítása folyamatban van, kiszállítás még nem indult el.`,gold:{event_type:'ORDER_PROCESSING',perspective:'buyer',order_id:'IK-40219',tracking_id:null,link_status:'linked'}},
  {id:'xb-005',input:`Feladó: noreply@barion.com\nTárgy: Tranzakció sikeres\n\nElfogadóhely: iPon\nKereskedői hivatkozás: IP-77125\nA bankkártyás fizetés jóváhagyva.`,gold:{event_type:'PAYMENT',perspective:'buyer',order_id:'IP-77125',tracking_id:null,link_status:'linked'}},
  {id:'xb-006',input:`Feladó: payment@otpmo.hu\nTárgy: Fizetés visszaigazolása\n\nPartner: Reserved\nOrder reference: RS-310842\nA tranzakció sikeresen lezárult.`,gold:{event_type:'PAYMENT',perspective:'buyer',order_id:'RS-310842',tracking_id:null,link_status:'linked'}},
  {id:'xb-007',input:`Feladó: no-reply@szamlazz.hu\nTárgy: Új e-számla\n\nVevői rendelés: EC-551820\nSzámla: EC-2026-8812\nAz elektronikus számla elkészült.`,gold:{event_type:'INVOICE',perspective:'buyer',order_id:'EC-551820',tracking_id:null,link_status:'linked'}},
  {id:'xb-008',input:`Feladó: invoice@merchant.example\nTárgy: Invoice available\n\nOrder ID: IK-40219\nInvoice number: 2026/10452.`,gold:{event_type:'INVOICE',perspective:'buyer',order_id:'IK-40219',tracking_id:null,link_status:'linked'}},
  {id:'xb-009',input:`Feladó: dispatch@reserved.com\nTárgy: A csomagszám elkészült\n\nRendelés: RS-310842\nSameday azonosító: SDY770019991\nA fuvarlevél rögzítve, de a küldemény még a raktárunkban vár felvételre.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'RS-310842',tracking_id:'SDY770019991',link_status:'linked'}},
  {id:'xb-010',input:`Feladó: noreply@gls-hungary.com\nTárgy: Csomaginformáció érkezett\n\nGLS szám: GLS330099821\nA feladó előzetesen bejelentette a csomagot. A küldeményt fizikailag még nem kaptuk meg.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:null,tracking_id:'GLS330099821',link_status:'unresolved'}},
  {id:'xb-011',input:`Feladó: shipping@ikea.hu\nTárgy: Szállítás előkészítve\n\nIK-40219\nDPD: DPD882200551\nA szállítási megbízást elküldtük a DPD-nek; a csomag átvétele később történik.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'IK-40219',tracking_id:'DPD882200551',link_status:'linked'}},
  {id:'xb-012',input:`Feladó: shipping@ecipo.hu\nTárgy: Elindult a csomagod\n\nRendelés EC-551820\nPacketa: PKT220411889\nA futárszolgálat ma 08:17-kor átvette tőlünk a küldeményt.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:'EC-551820',tracking_id:'PKT220411889',link_status:'linked'}},
  {id:'xb-013',input:`Feladó: noreply@mpl.hu\nTárgy: Felvett küldemény\n\nMPL223344551HU\nA küldemény a feladótól átvételre került és bekerült a postai hálózatba.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:null,tracking_id:'MPL223344551HU',link_status:'unresolved'}},
  {id:'xb-014',input:`BuyFlow context: AY-90017 rendeléshez korábban rögzített tracking: FOX881170045.\n\nFeladó: no-reply@foxpost.hu\nTárgy: Átvettük a csomagot\n\nFOX881170045 küldeményt a Foxpost átvette a feladótól.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:'AY-90017',tracking_id:'FOX881170045',link_status:'linked'}},
  {id:'xb-015',input:`BuyFlow context: rendelés RS-310842 trackingje SDY770019991.\n\nFeladó: info@sameday.hu\nTárgy: Továbbítás alatt\n\nSDY770019991 jelenleg a budapesti elosztóközpontból a célállomási depó felé halad.`,gold:{event_type:'IN_TRANSIT',perspective:'buyer',order_id:'RS-310842',tracking_id:'SDY770019991',link_status:'linked'}},
  {id:'xb-016',input:`Feladó: tracking@dpd.hu\nTárgy: Parcel movement\n\nDPD990177662 is being transported between DPD depots. No merchant or order reference is present.`,gold:{event_type:'IN_TRANSIT',perspective:'buyer',order_id:null,tracking_id:'DPD990177662',link_status:'unresolved'}},
  {id:'xb-017',input:`BuyFlow context: EC-551820 → PKT220411889.\n\nFeladó: info@packeta.hu\nTárgy: Ma érkezik\n\nA PKT220411889 küldeményt a kézbesítő futár magához vette, érkezés várható 09:30–12:30 között.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:'EC-551820',tracking_id:'PKT220411889',link_status:'linked'}},
  {id:'xb-018',input:`Feladó: info@gls-hungary.com\nTárgy: Kiszállítás folyamatban\n\nGLS330099821\nA csomag a kézbesítő gépkocsiján van, a futár ma megkísérli az átadást.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:null,tracking_id:'GLS330099821',link_status:'unresolved'}},
  {id:'xb-019',input:`BuyFlow context: IK-40219 rendelés trackingje DPD882200551.\n\nFeladó: info@dpd.hu\nTárgy: Your parcel is out for delivery\n\nDPD882200551 is with your driver and is scheduled for delivery today.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:'IK-40219',tracking_id:'DPD882200551',link_status:'linked'}},
  {id:'xb-020',input:`BuyFlow context: AY-90017 → FOX881170045.\n\nFeladó: no-reply@foxpost.hu\nTárgy: Megérkezett az automatába\n\nA FOX881170045 csomag átvehető. Az automata rekeszének nyitókódját SMS-ben elküldtük.`,gold:{event_type:'READY_FOR_PICKUP',perspective:'buyer',order_id:'AY-90017',tracking_id:'FOX881170045',link_status:'linked'}},
  {id:'xb-021',input:`BuyFlow context: rendelés MM-72051 trackingje GLS550180077.\n\nFeladó: info@gls-hungary.com\nTárgy: Csomagponti átvétel\n\nGLS550180077 megérkezett a kiválasztott ParcelShopba és átvehető.`,gold:{event_type:'READY_FOR_PICKUP',perspective:'buyer',order_id:'MM-72051',tracking_id:'GLS550180077',link_status:'linked'}},
  {id:'xb-022',input:`BuyFlow context: RS-310842 → SDY770019991.\n\nFeladó: info@sameday.hu\nTárgy: Kézbesítés befejezve\n\nSDY770019991 sikeresen átadva 16:03-kor.`,gold:{event_type:'DELIVERED',perspective:'buyer',order_id:'RS-310842',tracking_id:'SDY770019991',link_status:'linked'}},
  {id:'xb-023',input:`BuyFlow context: EC-551820 → PKT220411889.\n\nFeladó: info@packeta.hu\nTárgy: Delivered\n\nPKT220411889 was handed to the recipient successfully.`,gold:{event_type:'DELIVERED',perspective:'buyer',order_id:'EC-551820',tracking_id:'PKT220411889',link_status:'linked'}},
  {id:'xb-024',input:`Feladó: order@ikea.hu\nTárgy: Rendelés megszüntetve\n\nIK-40220\nA termék nem elérhető, ezért a rendelést töröltük és nem fogjuk kiszállítani.`,gold:{event_type:'CANCELLED',perspective:'buyer',order_id:'IK-40220',tracking_id:null,link_status:'linked'}},
  {id:'xb-025',input:`Feladó: payments@ipon.hu\nTárgy: Jóváírás megtörtént\n\nRendelés: IP-77125\nA teljes összeget visszautaltuk a vásárláskor használt bankkártyára.`,gold:{event_type:'REFUNDED',perspective:'buyer',order_id:'IP-77125',tracking_id:null,link_status:'linked'}},
  {id:'xb-026',input:`Feladó: returns@reserved.com\nTárgy: Visszáru beérkezett\n\nRendelés: RS-310842\nA visszaküldött terméket a raktárunk átvette, ellenőrzése következik.`,gold:{event_type:'RETURN',perspective:'buyer',order_id:'RS-310842',tracking_id:null,link_status:'linked'}},
  {id:'xb-027',input:`Feladó: newsletter@ecipo.hu\nTárgy: Hétvégi cipőakció\n\nMost 20% kedvezmény több száz modellre.`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb-028',input:`Feladó: account@ikea.hu\nTárgy: Biztonsági figyelmeztetés\n\nA fiókodhoz új eszközt adtak hozzá.`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb-029',input:`Feladó: collections@dpd.hu\nTárgy: Holnapi begyűjtés\n\nTisztelt Szerződött Partner! Futárunk holnap az Ön raktárában veszi fel az ügyfeleinek feladandó csomagokat.`,gold:{event_type:'OTHER',perspective:'merchant_outbound',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb-030',input:`BuyFlow context: MM-72051 rendelés trackingje GLS550180077.\n\nFeladó: survey@gls-hungary.com\nTárgy: Véleményed számít\n\nMennyire voltál elégedett a GLS550180077 küldemény átvételével?`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:'MM-72051',tracking_id:'GLS550180077',link_status:'linked'}}
];

fs.mkdirSync(OUT,{recursive:true});
const publicRows = cases.map(({id,input})=>({id,input}));
const goldRows = cases.map(({id,gold})=>({id,gold}));
const publicText = publicRows.map(x=>JSON.stringify(x)).join('\n')+'\n';
const goldText = goldRows.map(x=>JSON.stringify(x)).join('\n')+'\n';
fs.writeFileSync(path.join(OUT,'blind-input.jsonl'), publicText, 'utf8');
fs.writeFileSync(path.join(OUT,'blind-gold.jsonl'), goldText, 'utf8');
const sha = s=>crypto.createHash('sha256').update(s).digest('hex');
const manifest={dataset:'buyflow-v17-external-blind-v1',count:cases.length,policy:'Independent hand-authored holdout. Do not train on blind-input or blind-gold. If gold is inspected for tuning, mark this set spent.',input_sha256:sha(publicText),gold_sha256:sha(goldText)};
fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log('BUYFLOW V17 EXTERNAL BLIND READY');
console.log(`Output: ${OUT}`);
console.log(`Cases: ${cases.length} (FROZEN)`);
console.log(`input: ${manifest.input_sha256}`);
console.log(`gold: ${manifest.gold_sha256}`);
