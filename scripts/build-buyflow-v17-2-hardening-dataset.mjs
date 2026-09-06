import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.argv[2] || path.join(process.cwd(), 'training', 'v17-2-hardening');
const SEED = 17022026;
const SYSTEM = 'Analyze the commerce email from its actual meaning and evidence. Do not invent facts or links. Return the requested JSON.';

let state = SEED >>> 0;
function rnd(){ state=(Math.imul(state,1664525)+1013904223)>>>0; return state/2**32; }
function pick(a){ return a[Math.floor(rnd()*a.length)]; }
function shuffle(a){ const b=[...a]; for(let i=b.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; } return b; }
function sha256File(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

const merchants=[
 ['Decathlon','decathlon.hu'],['About You','aboutyou.hu'],['Notino','notino.hu'],['Dorko','dorko.hu'],
 ['MediaMarkt','mediamarkt.hu'],['eMAG','emag.hu'],['Pepita','pepita.hu'],['Alza','alza.hu'],
 ['GymBeam','gymbeam.hu'],['iPon','ipon.hu'],['Reserved','reserved.com'],['Mömax','moemax.hu']
];
const carriers=[['GLS','GLS'],['MPL','MPL'],['Foxpost','FOX'],['Packeta','PKT'],['DPD','DPD'],['Express One','EO']];
const products=['parfüm','sportcipő','robotporszívó','fejhallgató','gyerekjáték','pulóver','vitamin','kávéfőző','telefon tok','túrabakancs'];

const bank={
 train:{
  ORDER_CREATED:['A megrendelést sikeresen rögzítettük.','Köszönjük, rendelésed beérkezett rendszerünkbe.','A vásárlás visszaigazolása megtörtént.'],
  ORDER_PROCESSING:['A raktár megkezdte az összekészítést, futárnak még nem adtuk át.','Rendelésed feldolgozás alatt áll, a csomagolás folyamatban van.','A termékeket összekészítjük; fizikai feladás még nem történt.'],
  PAYMENT:['A bankkártyás fizetés sikeresen lezárult.','A tranzakció jóváhagyva, az összeg beérkezett.','Sikeres online fizetés.'],
  INVOICE:['Elektronikus számláját elkészítettük.','A számla kiállításra került.','Az e-számla elérhető.'],
  SHIPMENT_CREATED:['A fuvarozónak elektronikus adatot küldtünk, de a csomag még nálunk van.','A címke elkészült; a futár fizikailag még nem vette át a küldeményt.','Előzetes csomagadat rögzítve, tényleges átadás még nem történt.'],
  SHIPPED:['A csomagot fizikailag átadtuk a futárnak.','A fuvarozó átvette a küldeményt a feladótól.','A csomag elhagyta a raktárt, átadtuk a szállító partnernek.'],
  IN_TRANSIT:['A küldemény két depó között továbbítás alatt van.','A csomag a szállítási hálózatban halad a következő központ felé.','A küldeményt a regionális depóból továbbították.'],
  OUT_FOR_DELIVERY:['A csomag a kézbesítő járművén van, ma érkezik.','A futárnál van a küldemény, a kézbesítés a mai napon várható.','A mai kézbesítési körre kiadtuk a csomagot a futárnak.'],
  READY_FOR_PICKUP:['A csomag megérkezett az automatába és átvehető.','A küldemény az átvételi ponton vár, mostantól átvehető.','Az átvételi kód aktív, a csomag a rekeszben van.'],
  DELIVERED:['A címzett a küldeményt sikeresen átvette.','A kézbesítés megtörtént, a csomagot átadtuk a címzettnek.','Kézbesítve: az átvétel sikeres volt.'],
  CANCELLED:['A rendelést töröltük, nem kerül kiszállításra.','A megrendelés megszüntetésre került.','A rendelést kérésedre töröltük.'],
  REFUNDED:['A visszatérítést teljesítettük az eredeti fizetési módra.','Az összeget sikeresen visszautaltuk.','A refund lezárult, a pénz visszatérítésre került.'],
  RETURN:['A visszaküldött terméket átvettük feldolgozásra.','A visszáru beérkezett a raktárba.','A visszaküldési folyamat aktív, a csomagot átvettük.']
 },
 val:{
  ORDER_CREATED:['Megrendelésed fogadva, a rendelési azonosítót lent találod.','A rendelési igényedet rögzítettük és visszaigazoljuk.'],
  ORDER_PROCESSING:['A rendelés a raktári előkészítés szakaszában van; futárátadás még nincs.','A csomag összeállítása folyamatban, kiszállításra még nem adtuk át.'],
  PAYMENT:['Fizetés elfogadva, a tranzakció sikeres.','A fizetési szolgáltató jóváhagyta a tranzakciót.'],
  INVOICE:['Számladokumentum elkészült és megnyitható.','A vásárláshoz tartozó számlát kiállítottuk.'],
  SHIPMENT_CREATED:['Shipment data received by carrier; parcel is still with sender.','A futárcég csak az adatokat kapta meg, a doboz fizikailag még a feladónál van.'],
  SHIPPED:['Carrier collected the parcel from the sender.','A küldeményt ténylegesen átadták a szállítónak, aki átvette.'],
  IN_TRANSIT:['The parcel is moving through the carrier network between hubs.','A csomag depók közötti szállításban van.'],
  OUT_FOR_DELIVERY:['Out for delivery: the courier has the parcel on today’s route.','A kézbesítő ma viszi ki a csomagot, már a járművén van.'],
  READY_FOR_PICKUP:['Ready for pickup at the selected parcel locker.','A csomag átvételre kész az átvételi ponton.'],
  DELIVERED:['Delivered to recipient successfully.','A címzett átvette, a kézbesítés lezárult.'],
  CANCELLED:['A rendelés véglegesen törölve lett.','A megrendelést megszüntettük, teljesítés nem lesz.'],
  REFUNDED:['A visszafizetés sikeresen teljesítve.','Refund completed.'],
  RETURN:['A visszaküldött áru beérkezett és feldolgozásra vár.','Return parcel received by warehouse.']
 }
};

function ids(i){
 const [merchant,domain]=pick(merchants); const [carrier,prefix]=pick(carriers);
 const stem=merchant.normalize('NFD').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase() || 'ORD';
 return {merchant,domain,carrier,order:`${stem}-${730000+i}`,tracking:`${prefix}${990000000+i}`,product:pick(products)};
}
function email(from,subject,body){ return `Feladó: ${from}\nTárgy: ${subject}\n\n${body}`; }
function target(event_type,perspective,order_id,tracking_id,link_status,evidence){ return {event_type,perspective,order_id,tracking_id,link_status,evidence}; }
function row(id,input,answer,tags){ return {id,messages:[
 {role:'system',content:SYSTEM},
 {role:'user',content:`Elemezd ezt az e-mailt BuyFlow szerint. Adj vissza JSON-t ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status, evidence.\n\n${input}`},
 {role:'assistant',content:JSON.stringify(answer)}
 ],meta:tags}; }
function decorate(text,label,i,split){
 if(i%7===0){
  const old = label==='SHIPMENT_CREATED' ? 'Korábbi üzenet: a rendelés feldolgozás alatt állt.' : 'Korábbi automatikus értesítés: csomagadat létrehozva.';
  return `${text}\n\n--- Korábbi idézett üzenet ---\n${old}`;
 }
 if(i%11===0) return `Online megtekintés | automatikus üzenet\n\n${text}\n\nEz egy automatikus értesítés.`;
 return text;
}

function linkedVariant(x,i){
 const v=i%4;
 if(v===0) return {prefix:`Rendelés: ${x.order}\nCsomagszám: ${x.tracking}\n`,order:x.order,status:'linked',tag:'exact-order-tracking'};
 if(v===1) return {prefix:`Csomagszám: ${x.tracking}\n`,order:null,status:'unresolved',tag:'tracking-only'};
 if(v===2) return {prefix:`Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\nCsomagszám: ${x.tracking}\n`,order:x.order,status:'linked',tag:'verified-context'};
 const other=`ALT-${810000+i}`;
 return {prefix:`Lehetséges rendelések: ${x.order} vagy ${other}. Nincs igazolt hozzárendelés.\nCsomagszám: ${x.tracking}\n`,order:null,status:'unresolved',tag:'ambiguous-order'};
}

function make(label,i,split){
 const x=ids(i+(split==='val'?5000:0)); const pbank=bank[split];
 if(['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','CANCELLED','REFUNDED','RETURN'].includes(label)){
  const p=pick(pbank[label]);
  let from=`noreply@${x.domain}`, subject=label, body=`Rendelés: ${x.order}\n${p}`;
  if(label==='PAYMENT'){ from='noreply@simplepay.hu'; subject='Fizetési értesítés'; body=`Kereskedő: ${x.merchant}\nRendelési hivatkozás: ${x.order}\n${p}`; }
  if(label==='INVOICE'){ from='noreply@billingo.hu'; subject='Számla'; body=`Eladó: ${x.merchant}\nRendelési hivatkozás: ${x.order}\n${p}`; }
  const t={ORDER_CREATED:'order',ORDER_PROCESSING:'processing',PAYMENT:'payment',INVOICE:'invoice',CANCELLED:'cancel',REFUNDED:'refund',RETURN:'return'}[label];
  return row('',decorate(email(from,subject,body),label,i,split),target(label,'buyer',x.order,null,'linked',p),[t,'hardening']);
 }
 if(['SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED'].includes(label)){
  const p=pick(pbank[label]); const lv=linkedVariant(x,i);
  const subject={SHIPMENT_CREATED:'Küldeményadat rögzítve',SHIPPED:'Csomag feladva',IN_TRANSIT:'Küldemény továbbítás alatt',OUT_FOR_DELIVERY:'Kézbesítés ma',READY_FOR_PICKUP:'Csomag átvehető',DELIVERED:'Kézbesítve'}[label];
  const sender=['IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED'].includes(label)?'status@carrier.example':`shipping@${x.domain}`;
  const text=decorate(email(sender,subject,`${lv.prefix}${p}`),label,i,split);
  return row('',text,target(label,'buyer',lv.order,x.tracking,lv.status,p),['hardening',lv.tag,`boundary:${label.toLowerCase()}`]);
 }
 if(label==='OTHER'){
  const v=i%6;
  if(v===0||v===1){
   const p=split==='train' ? pick([
    'Tisztelt Webshop Partner! Futárunk ma érkezik az Ön telephelyére a vásárlóinak feladandó csomagok átvételére.',
    'A mai napon begyűjtjük az Ön által vevőinek feladandó küldeményeket.',
    'A futár a feladói raktárból veszi át az Ön webshopja által előkészített csomagokat.'
   ]) : pick([
    'Partner pickup notice: our courier will collect parcels your shop is sending to customers.',
    'Webshop partner értesítés: a futár az Ön feladandó csomagjaiért érkezik.'
   ]);
   return row('',email('pickup@carrier.example','Partner csomagfelvétel',p),target('OTHER','merchant_outbound',null,null,'not_applicable',p),['merchant_outbound','hardening']);
  }
  if(v===2){
   const p=split==='train'?'Csak ma: -25% a kijelölt termékekre. A PROMO990123 nem csomagszám.':'Weekend sale: use code GLS990123456; this is a coupon, not tracking.';
   return row('',email(`promo@${x.domain}`,'Akció',p),target('OTHER','non_purchase',null,null,'not_applicable',p),['marketing','fake-id','hardening']);
  }
  if(v===3){
   const p=split==='train'?'Új eszközről történt bejelentkezés. Ha nem te voltál, változtass jelszót.':'Security alert: a new device signed in to your account.';
   return row('',email(`security@${x.domain}`,'Biztonsági értesítés',p),target('OTHER','non_purchase',null,null,'not_applicable',p),['security','hardening']);
  }
  if(v===4){
   const p=split==='train'?`Mennyire voltál elégedett a ${x.tracking} csomag kézbesítésével?`:`Please rate delivery of parcel ${x.tracking}.`;
   const context=`Ismert BuyFlow kapcsolat: ${x.order} rendelés trackingje ${x.tracking}.\n\n`;
   return row('',`${context}${email('survey@carrier.example','Értékeld a kézbesítést',p)}`,target('OTHER','non_purchase',x.order,x.tracking,'linked',p),['survey','related-non-lifecycle','hardening']);
  }
  const p=split==='train'?`Módosíthatod a ${x.tracking} küldemény értesítési nyelvét. Ez nem állapotváltozás.`:`Notification preferences for ${x.tracking} can be changed; parcel status is unchanged.`;
  return row('',email('settings@carrier.example','Értesítési beállítások',p),target('OTHER','non_purchase',null,x.tracking,'unresolved',p),['non-lifecycle','tracking-present','hardening']);
 }
 throw new Error(`Unknown label ${label}`);
}

const trainPlan=[
 ['ORDER_CREATED',10],['ORDER_PROCESSING',10],['PAYMENT',8],['INVOICE',8],
 ['SHIPMENT_CREATED',28],['SHIPPED',28],['IN_TRANSIT',24],['OUT_FOR_DELIVERY',24],
 ['READY_FOR_PICKUP',14],['DELIVERED',14],['CANCELLED',8],['REFUNDED',8],['RETURN',8],['OTHER',48]
];
const valPlan=[
 ['ORDER_CREATED',3],['ORDER_PROCESSING',3],['PAYMENT',3],['INVOICE',3],
 ['SHIPMENT_CREATED',7],['SHIPPED',7],['IN_TRANSIT',6],['OUT_FOR_DELIVERY',6],
 ['READY_FOR_PICKUP',4],['DELIVERED',4],['CANCELLED',3],['REFUNDED',3],['RETURN',3],['OTHER',5]
];

function build(plan,split){
 const rows=[]; let n=0;
 for(const [label,count] of plan){ for(let i=0;i<count;i++){ const r=make(label, n+i, split); r.id=`v17-2-${split}-${String(n+i+1).padStart(5,'0')}`; rows.push(r); } n+=count; }
 return shuffle(rows);
}

const train=build(trainPlan,'train');
const validation=build(valPlan,'val');
if(train.length!==240) throw new Error(`train count ${train.length}`);
if(validation.length!==60) throw new Error(`validation count ${validation.length}`);

fs.mkdirSync(OUT,{recursive:true});
const trainFile=path.join(OUT,'train.jsonl');
const valFile=path.join(OUT,'validation.jsonl');
fs.writeFileSync(trainFile,train.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8');
fs.writeFileSync(valFile,validation.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8');
const manifest={
 dataset:'buyflow-v17-2-hardening',seed:SEED,train:train.length,validation:validation.length,
 purpose:'second-stage hardening focused on semantic boundaries, linking, perspective, and non-lifecycle negatives',
 validation_template_family:'disjoint from train phrase bank',
 external_blind_v2:'not included',
 train_sha256:sha256File(trainFile),validation_sha256:sha256File(valFile)
};
fs.writeFileSync(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log('==============================================================');
console.log('BUYFLOW V17.2 HARDENING DATASET READY');
console.log(`Output: ${OUT}`);
console.log(`Train: ${train.length}`);
console.log(`Validation: ${validation.length}`);
console.log(`train sha256: ${manifest.train_sha256}`);
console.log(`validation sha256: ${manifest.validation_sha256}`);
console.log('External Blind V2: NOT READ / NOT MODIFIED');
console.log('Production: OFF');
console.log('==============================================================');