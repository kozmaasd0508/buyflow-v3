import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(process.cwd(), 'evaluation', 'v17-external-blind-v2');

const cases = [
  {id:'xb2-001',input:`Feladó: order@zara.com\nTárgy: Megrendelésed megérkezett\n\nRendelésazonosító: ZR-482731\nA rendelésedet sikeresen fogadtuk.`,gold:{event_type:'ORDER_CREATED',perspective:'buyer',order_id:'ZR-482731',tracking_id:null,link_status:'linked'}},
  {id:'xb2-002',input:`Feladó: noreply@gymbeam.hu\nTárgy: Köszönjük a rendelést #GB-661902\n\nA GB-661902 számú megrendelés bekerült rendszerünkbe.`,gold:{event_type:'ORDER_CREATED',perspective:'buyer',order_id:'GB-661902',tracking_id:null,link_status:'linked'}},
  {id:'xb2-003',input:`Feladó: webshop@samsung.com\nTárgy: Rendelésed előkészítés alatt\n\nAzonosító: SS-104882\nA raktár dolgozik a rendelésen. Futár részére még nem történt átadás.`,gold:{event_type:'ORDER_PROCESSING',perspective:'buyer',order_id:'SS-104882',tracking_id:null,link_status:'linked'}},
  {id:'xb2-004',input:`Feladó: shop@praktiker.hu\nTárgy: Összekészítés megkezdve\n\nRendelés PR-771046. A termékeket a raktárban összeszedjük; kiszállítás még nem indult.`,gold:{event_type:'ORDER_PROCESSING',perspective:'buyer',order_id:'PR-771046',tracking_id:null,link_status:'linked'}},
  {id:'xb2-005',input:`Feladó: noreply@simplepay.hu\nTárgy: Sikeres bankkártyás tranzakció\n\nKereskedő: Samsung\nKereskedői referencia: SS-104882\nA fizetés engedélyezve és sikeresen lezárva.`,gold:{event_type:'PAYMENT',perspective:'buyer',order_id:'SS-104882',tracking_id:null,link_status:'linked'}},
  {id:'xb2-006',input:`Feladó: payment@barion.com\nTárgy: Fizetés sikeres\n\nPartner: GymBeam\nOrder: GB-661902\nA tranzakció sikeresen teljesült.`,gold:{event_type:'PAYMENT',perspective:'buyer',order_id:'GB-661902',tracking_id:null,link_status:'linked'}},
  {id:'xb2-007',input:`Feladó: noreply@billingo.hu\nTárgy: Számla elkészült\n\nRendelési hivatkozás: PR-771046\nSzámlaszám: PRT-2026-11902\nAz elektronikus számlát kiállítottuk.`,gold:{event_type:'INVOICE',perspective:'buyer',order_id:'PR-771046',tracking_id:null,link_status:'linked'}},
  {id:'xb2-008',input:`Feladó: invoice@zara.com\nTárgy: Your invoice\n\nOrder: ZR-482731\nInvoice: ZA-881044\nYour invoice is now available.`,gold:{event_type:'INVOICE',perspective:'buyer',order_id:'ZR-482731',tracking_id:null,link_status:'linked'}},
  {id:'xb2-009',input:`Feladó: dispatch@samsung.com\nTárgy: Fuvarlevél elkészült\n\nRendelés: SS-104882\nExpress One: EO440077219\nA fuvarozási adatokat rögzítettük, de a csomag még nálunk van és átvételre vár.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'SS-104882',tracking_id:'EO440077219',link_status:'linked'}},
  {id:'xb2-010',input:`Feladó: info@dpd.hu\nTárgy: Shipment data received\n\nDPD azonosító: DPD551002778\nA feladó elküldte a csomag elektronikus adatait. Fizikai átvétel még nem történt.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:null,tracking_id:'DPD551002778',link_status:'unresolved'}},
  {id:'xb2-011',input:`Feladó: shipping@praktiker.hu\nTárgy: Szállítási megbízás rögzítve\n\nPR-771046\nMPL azonosító: MPL884420011HU\nA postai címke elkészült; a küldeményt az MPL még nem vette át.`,gold:{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'PR-771046',tracking_id:'MPL884420011HU',link_status:'linked'}},
  {id:'xb2-012',input:`Feladó: shipping@gymbeam.hu\nTárgy: Átadtuk a csomagod\n\nRendelés: GB-661902\nPacketa: PKT991155023\nA Packeta futára a csomagot ma 09:12-kor átvette tőlünk.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:'GB-661902',tracking_id:'PKT991155023',link_status:'linked'}},
  {id:'xb2-013',input:`Feladó: info@expressone.hu\nTárgy: Küldemény felvéve\n\nEO990076612\nA küldeményt a feladó telephelyén átvettük és szállításba vettük. Rendelési hivatkozás nincs az üzenetben.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:null,tracking_id:'EO990076612',link_status:'unresolved'}},
  {id:'xb2-014',input:`BuyFlow context: ZR-482731 rendelés trackingje FOX665512009.\n\nFeladó: no-reply@foxpost.hu\nTárgy: Csomag átvéve\n\nA FOX665512009 küldeményt a feladótól átvettük.`,gold:{event_type:'SHIPPED',perspective:'buyer',order_id:'ZR-482731',tracking_id:'FOX665512009',link_status:'linked'}},
  {id:'xb2-015',input:`BuyFlow context: SS-104882 rendelés trackingje EO440077219.\n\nFeladó: info@expressone.hu\nTárgy: Továbbítás folyamatban\n\nEO440077219 elhagyta a központi feldolgozót és a célrégió depója felé halad.`,gold:{event_type:'IN_TRANSIT',perspective:'buyer',order_id:'SS-104882',tracking_id:'EO440077219',link_status:'linked'}},
  {id:'xb2-016',input:`Feladó: tracking@gls-hungary.com\nTárgy: Küldemény mozgásban\n\nGLS770011248\nA csomag két GLS depó között továbbítás alatt van. Rendelési vagy kereskedői hivatkozás nincs.`,gold:{event_type:'IN_TRANSIT',perspective:'buyer',order_id:null,tracking_id:'GLS770011248',link_status:'unresolved'}},
  {id:'xb2-017',input:`BuyFlow context: GB-661902 → PKT991155023.\n\nFeladó: info@packeta.hu\nTárgy: Ma kézbesítjük\n\nA PKT991155023 csomag a kézbesítő futárnál van. Várható érkezés ma 10:20–13:20.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:'GB-661902',tracking_id:'PKT991155023',link_status:'linked'}},
  {id:'xb2-018',input:`Feladó: info@expressone.hu\nTárgy: Futárnál a küldemény\n\nEO990076612\nA csomagot a mai kézbesítési körre kiadtuk a futárnak. Rendelési referencia nincs.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:null,tracking_id:'EO990076612',link_status:'unresolved'}},
  {id:'xb2-019',input:`BuyFlow context: PR-771046 rendelés trackingje MPL884420011HU.\n\nFeladó: noreply@posta.hu\nTárgy: Kézbesítés ma\n\nMPL884420011HU a kézbesítőnél van, az átadást a mai napon megkíséreljük.`,gold:{event_type:'OUT_FOR_DELIVERY',perspective:'buyer',order_id:'PR-771046',tracking_id:'MPL884420011HU',link_status:'linked'}},
  {id:'xb2-020',input:`BuyFlow context: ZR-482731 → FOX665512009.\n\nFeladó: no-reply@foxpost.hu\nTárgy: Átveheted a csomagod\n\nFOX665512009 bekerült a kiválasztott automatába. Az átvételi kód aktív.`,gold:{event_type:'READY_FOR_PICKUP',perspective:'buyer',order_id:'ZR-482731',tracking_id:'FOX665512009',link_status:'linked'}},
  {id:'xb2-021',input:`BuyFlow context: rendelés MM-88140 trackingje GLS881122070.\n\nFeladó: info@gls-hungary.com\nTárgy: ParcelShop értesítés\n\nGLS881122070 megérkezett az átvételi pontra, a címzett átveheti.`,gold:{event_type:'READY_FOR_PICKUP',perspective:'buyer',order_id:'MM-88140',tracking_id:'GLS881122070',link_status:'linked'}},
  {id:'xb2-022',input:`BuyFlow context: SS-104882 → EO440077219.\n\nFeladó: info@expressone.hu\nTárgy: Kézbesítve\n\nEO440077219 kézbesítése sikeresen megtörtént 13:48-kor.`,gold:{event_type:'DELIVERED',perspective:'buyer',order_id:'SS-104882',tracking_id:'EO440077219',link_status:'linked'}},
  {id:'xb2-023',input:`BuyFlow context: GB-661902 → PKT991155023.\n\nFeladó: info@packeta.hu\nTárgy: Delivery complete\n\nPKT991155023 was successfully handed over to the recipient.`,gold:{event_type:'DELIVERED',perspective:'buyer',order_id:'GB-661902',tracking_id:'PKT991155023',link_status:'linked'}},
  {id:'xb2-024',input:`Feladó: order@praktiker.hu\nTárgy: Rendelés törölve\n\nPR-771099\nA megrendelt termék elfogyott, ezért a rendelést töröltük. Kiszállítás nem lesz.`,gold:{event_type:'CANCELLED',perspective:'buyer',order_id:'PR-771099',tracking_id:null,link_status:'linked'}},
  {id:'xb2-025',input:`Feladó: payments@samsung.com\nTárgy: Visszatérítés teljesítve\n\nRendelés: SS-104882\nA teljes vételárat visszautaltuk az eredeti fizetési módra.`,gold:{event_type:'REFUNDED',perspective:'buyer',order_id:'SS-104882',tracking_id:null,link_status:'linked'}},
  {id:'xb2-026',input:`Feladó: returns@gymbeam.hu\nTárgy: Visszaküldött termék beérkezett\n\nRendelés: GB-661902\nA visszaküldött terméket raktárunk átvette és feldolgozásra vár.`,gold:{event_type:'RETURN',perspective:'buyer',order_id:'GB-661902',tracking_id:null,link_status:'linked'}},
  {id:'xb2-027',input:`Feladó: newsletter@zara.com\nTárgy: Új szezon, új kedvencek\n\nNézd meg az őszi kollekció legújabb darabjait.`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb2-028',input:`Feladó: account@samsung.com\nTárgy: Bejelentkezési figyelmeztetés\n\nÚj böngészőből jelentkeztek be a Samsung-fiókodba.`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb2-029',input:`Feladó: pickup@expressone.hu\nTárgy: Partneri napi felvétel\n\nTisztelt Webáruház! Futárunk ma az Ön raktárában veszi át a vevőinek feladandó küldeményeket.`,gold:{event_type:'OTHER',perspective:'merchant_outbound',order_id:null,tracking_id:null,link_status:'not_applicable'}},
  {id:'xb2-030',input:`BuyFlow context: MM-88140 rendelés trackingje GLS881122070.\n\nFeladó: survey@gls-hungary.com\nTárgy: Mondd el a véleményed\n\nKérjük értékeld, mennyire voltál elégedett a GLS881122070 küldemény átvételével.`,gold:{event_type:'OTHER',perspective:'non_purchase',order_id:'MM-88140',tracking_id:'GLS881122070',link_status:'linked'}}
];

fs.mkdirSync(OUT,{recursive:true});
const inputRows=cases.map(({id,input})=>({id,input}));
const goldRows=cases.map(({id,gold})=>({id,gold}));
const inputText=inputRows.map(x=>JSON.stringify(x)).join('\n')+'\n';
const goldText=goldRows.map(x=>JSON.stringify(x)).join('\n')+'\n';
fs.writeFileSync(path.join(OUT,'blind-input.jsonl'),inputText,'utf8');
fs.writeFileSync(path.join(OUT,'blind-gold.jsonl'),goldText,'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const manifest={dataset:'buyflow-v17-external-blind-v2',count:cases.length,policy:'FROZEN holdout. Training dataset was frozen before this benchmark. Do not tune prompts, labels, or training examples from per-case results. Aggregate-only baseline output.',input_sha256:sha(inputText),gold_sha256:sha(goldText)};
fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log('BUYFLOW V17 EXTERNAL BLIND V2 READY');
console.log(`Output: ${OUT}`);
console.log(`Cases: ${cases.length} (FROZEN)`);
console.log(`input: ${manifest.input_sha256}`);
console.log(`gold: ${manifest.gold_sha256}`);
