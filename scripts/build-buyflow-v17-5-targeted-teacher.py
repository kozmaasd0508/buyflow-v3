import hashlib, json, random, re
from collections import Counter
from pathlib import Path

SEED=1752026
SYSTEM='Analyze the commerce email from its actual meaning and evidence. Do not invent facts, identifiers, links, perspectives, or event labels. Return only the requested JSON.'
EVENTS=['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER']
PERS=['buyer','merchant_outbound','non_purchase']
LINKS=['linked','unresolved','not_applicable']
COUNTS_T={'lifecycle_boundary':700,'nonpurchase_noise':400,'link_status':300,'invoice_payment':220,'return_refund_boundary':240,'merchant_outbound':180,'id_safety':180,'retention':180}
COUNTS_V={'lifecycle_boundary':100,'nonpurchase_noise':60,'link_status':40,'invoice_payment':30,'return_refund_boundary':30,'merchant_outbound':20,'id_safety':20,'retention':20}
MERCHANTS_T=[('NordShop','nordshop.hu'),('TechBox','techbox.hu'),('UrbanWear','urbanwear.hu'),('HomeLab','homelab.hu'),('SportHive','sporthive.hu'),('BeautyDock','beautydock.hu'),('KidPlanet','kidplanet.hu'),('BookNest','booknest.hu'),('MegaMarket','megamarket.hu'),('DigitalPoint','digitalpoint.hu')]
MERCHANTS_V=[('AlphaStore','alphastore.hu'),('PrimeCart','primecart.hu'),('CityGear','citygear.hu'),('HouseMix','housemix.hu'),('RunWorld','runworld.hu'),('GlowMarket','glowmarket.hu')]
CARRIERS_T=[('GLS','GLS'),('DPD','DPD'),('Express One','EO'),('MPL','MPL'),('Foxpost','FOX'),('Packeta','PKT'),('UPS','UPS'),('Sameday','SDY')]
CARRIERS_V=[('ParcelOne','PCL'),('QuickShip','QS'),('BoxRoute','BOX'),('EuroParcel','EP')]
PRODUCTS_T=['okostelefon','sportcipő','parfüm','monitor','kávéfőző','fejhallgató','robotporszívó','hátizsák','építőjáték','karóra']
PRODUCTS_V=['tablet','túracipő','hajszárító','billentyűzet','konyhai robotgép','társasjáték']
PH={'train':{
'shipment_created':['A fuvarcímke létrejött, de a csomag még a feladó telephelyén van.','A fuvarozó elektronikus előértesítést kapott; fizikai átvétel még nem történt.','Tracking azonosító készült, a futár begyűjtési scan-je még hiányzik.','A doboz lezárva vár a raktárban, a szállító még nem vette át.','Shipment data received. Carrier collection has not happened yet.'],
'shipped':['A futár a feladótól fizikailag átvette a lezárt csomagot.','A küldeményt átadták a fuvarozónak, már nincs a kereskedő birtokában.','Origin pickup completed; the carrier collected the parcel from the sender.','A sofőr átvételi scan-je megtörtént a feladói rámpán.','A csomagot a szállító partner elszállította a webshop raktárából.'],
'in_transit':['A csomag a fuvarozó hálózatában depók között mozog.','Hub scan után a küldemény a következő logisztikai központ felé tart.','Linehaul departure recorded; local delivery route has not started.','A küldemény feldolgozóközpontból továbbindult, még nincs kézbesítőnél.','Transit movement is active inside the carrier network.'],
'out_for_delivery':['A helyi depó a mai kézbesítési kör futárának adta a csomagot.','A küldemény a kézbesítő járművén van, érkezése ma várható.','Loaded to delivery vehicle; estimated delivery is today.','A futár a mai útvonalán viszi a csomagot a címzetthez.','Kézbesítésre kiadva a helyi futárnak a mai napra.'],
'ready':['A csomag az automatában van, az átvételi kód aktív.','A küldemény megérkezett a partnerpontra és mostantól átvehető.','Locker placement completed; pickup is available now.','A csomagot a rekeszbe helyezték, az átvétel megkezdhető.','Az átvételi pont készletre vette a küldeményt.'],
'delivered':['A címzett fizikailag átvette a küldeményt, a kézbesítés lezárult.','Proof of delivery recorded; recipient handoff completed.','A futár sikeresen átadta a csomagot a címzettnek.','Kézbesítve: az átvételt a címzett megerősítette.','A csomag átadása megtörtént, további kézbesítés nincs.']},'val':{
'shipment_created':['A csomagadatot elküldték a futárcégnek, de a küldemény még a feladónál maradt.','Label generated; no physical carrier possession yet.','A raktár elkészítette a címkét, begyűjtésre még nem került sor.'],
'shipped':['A fuvarozó ténylegesen birtokba vette a csomagot a feladónál.','Physical handoff to the carrier is complete.','A feladói átadás megtörtént, a csomag elhagyta a kereskedő telephelyét.'],
'in_transit':['A küldemény központok közötti továbbításban van, kézbesítőhöz még nem került.','Carrier hub movement is underway; last-mile delivery has not begun.','A csomag a logisztikai hálózat következő állomására tart.'],
'out_for_delivery':['A csomagot a mai címkörzet futárjának járművére tették.','The local courier is carrying the parcel on today’s route.','A helyi kézbesítő átvette a csomagot a mai kiszállításhoz.'],
'ready':['A küldemény az átvételi helyen vár és azonnal átvehető.','Pickup point received the parcel and collection is enabled.','A rekeszben lévő csomaghoz az átvételi kód már használható.'],
'delivered':['A címzetti átadás sikeresen befejeződött.','Recipient acceptance was recorded and delivery is complete.','A küldeményt a címzettnek átadták, a folyamat lezárult.']}}
rng=random.Random(SEED)
def pick(a): return a[rng.randrange(len(a))]
def ids(i,split):
    ms=MERCHANTS_T if split=='train' else MERCHANTS_V; cs=CARRIERS_T if split=='train' else CARRIERS_V; ps=PRODUCTS_T if split=='train' else PRODUCTS_V
    m,dom=pick(ms); c,prefix=pick(cs); b=510000 if split=='train' else 910000; stem=re.sub('[^A-Za-z]','',m).upper()[:3] or 'ORD'
    return dict(merchant=m,domain=dom,carrier=c,order=f'{stem}-{b+i}',tracking=f'{prefix}{740000000+(i if split=="train" else 50000+i)}',product=pick(ps))
def email(sender,subject,body): return f'Feladó: {sender}\nTárgy: {subject}\n\n{body}'
def decorate(text,i,split,current_event=None):
    forms=[lambda t:t,lambda t:f'Online változat | Automatikus értesítés\n\n{t}\n\nÜgyfélszolgálat | Adatkezelés',lambda t:f'Automatikus rendszerüzenet\n{t}\n\nKérjük, erre az üzenetre ne válaszolj.',lambda t:f'{t}\n\n--- Lábléc ---\nAlkalmazás | Web | Leiratkozás',lambda t:t.replace('\n\n','\n')]
    out=f'Message-ID: <bf-{split}-{i}@notify.example>\n'+forms[i%len(forms)](text)
    if i%7==0 and current_event:
        old={'SHIPMENT_CREATED':'Korábbi állapot: a rendelés összekészítése folyamatban volt.','SHIPPED':'Korábbi állapot: a címke elkészült, de a futár még nem vette át.','IN_TRANSIT':'Korábbi állapot: a feladó átadta a csomagot a futárnak.','OUT_FOR_DELIVERY':'Korábbi állapot: a csomag két depó között mozgott.','READY_FOR_PICKUP':'Korábbi állapot: a csomag az automatát kiszolgáló járaton volt.','DELIVERED':'Korábbi állapot: a futár kézbesítésre vitte a csomagot.'}.get(current_event,'Korábbi rendszerüzenet: nincs aktuális státuszértéke.')
        out+=f'\n\n--- Korábbi idézett üzenet ---\n> {old}'
    return out
def tgt(event,pers,order,tracking,link,evidence): return dict(event_type=event,perspective=pers,order_id=order,tracking_id=tracking,link_status=link,evidence=evidence)
def row(rid,inp,ans,tags): return {'id':rid,'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':'Elemezd ezt az e-mailt BuyFlow szerint. Adj vissza JSON-t ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status, evidence.\n\n'+inp},{'role':'assistant','content':json.dumps(ans,ensure_ascii=False,separators=(',',':'))}],'meta':tags}
def make_lifecycle(i,split):
    x=ids(i,split); labels=['SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED']; ev=labels[i%len(labels)]; key={'SHIPMENT_CREATED':'shipment_created','SHIPPED':'shipped','IN_TRANSIT':'in_transit','OUT_FOR_DELIVERY':'out_for_delivery','READY_FOR_PICKUP':'ready','DELIVERED':'delivered'}[ev]; phrase=pick(PH['train' if split=='train' else 'val'][key]); v=(i//len(labels))%5
    if v==0: relation=f'BuyFlow kapcsolat: rendelés {x["order"]} ↔ tracking {x["tracking"]}.\n'; order=x['order']; link='linked'
    elif v==1: relation=f'Csomagszám: {x["tracking"]}\n'; order=None; link='unresolved'
    elif v==2: relation=f'Rendelés: {x["order"]}\nCsomagszám: {x["tracking"]}\n'; order=x['order']; link='linked'
    elif v==3: relation=f'Csomagszám: {x["tracking"]}\nLehetséges rendelések: {x["order"]} vagy ALT-{630000+i}; igazolt kapcsolat nincs.\n'; order=None; link='unresolved'
    else: relation=f'Igazolt rendelési hivatkozás: {x["order"]}\nCsomagszám: {x["tracking"]}\n'; order=x['order']; link='linked'
    subj={'SHIPMENT_CREATED':'Küldeményadat rögzítve','SHIPPED':'Feladói átadás','IN_TRANSIT':'Hálózati továbbítás','OUT_FOR_DELIVERY':'Mai kézbesítés','READY_FOR_PICKUP':'Átvehető csomag','DELIVERED':'Kézbesítés lezárva'}[ev]
    return row('',decorate(email(f'status@{x["domain"]}',subj,relation+phrase),i,split,ev),tgt(ev,'buyer',order,x['tracking'],link,phrase),['v17.5',split,'targeted','lifecycle-boundary',f'event:{ev.lower()}'])
def make_nonpurchase(i,split):
    x=ids(i,split); v=i%6
    banks=[('Hétvégi kedvezmény',f'Kupon: {x["tracking"]}-SALE. Ez promóciós kód, nem csomagszám. 20% kedvezmény a kijelölt termékekre.'),('Szállítási útmutató',f'Példa a súgóban: tracking {x["tracking"]}. Ez kizárólag szemléltető minta, nincs hozzá valódi küldemény.'),('Fiókbiztonság','Új bejelentkezést észleltünk. Rendelési vagy szállítási állapot nem változott.'),('Értesítési beállítás','A push értesítések engedélyezve lettek. Ez csak kommunikációs beállítás, nem csomagstátusz.'),('Értékeld a vásárlást',f'BuyFlow kapcsolat: {x["order"]} / {x["tracking"]}. A korábbi kézbesítésről kérünk értékelést; nincs új lifecycle esemény.'),('Terméktipp',f'Nézd meg új {x["product"]} ajánlatainkat. Referencia: PROMO-{610000+i}. Nincs rendelés vagy szállítási esemény.')] if split=='train' else [('Akciós értesítő',f'Kampánykód: {x["tracking"]}-VIP; nem nyomkövetési azonosító, kizárólag kedvezmény.'),('API dokumentáció',f'Mintaként szereplő parcel id: {x["tracking"]}. Ez dokumentációs példa, nem valós csomag.'),('Jelszóvédelem','Biztonsági értesítés a fiókhoz. Nincs vásárlási vagy logisztikai állapotváltozás.'),('Csatornaváltás','Az e-mailes értesítést push üzenetre állítottad. Csomagállapot nem változott.'),('Véleménykérés',f'Igazolt korábbi kapcsolat: {x["order"]} ↔ {x["tracking"]}. Csak elégedettségi kérdőív, új esemény nincs.'),('Ajánló',f'Új termékajánló érkezett. Kampányhivatkozás CAMP-{710000+i}; ez nem order vagy tracking.')]
    subj,body=banks[v]; ans=tgt('OTHER','non_purchase',x['order'],x['tracking'],'linked','nincs új lifecycle esemény; kérdőív') if v==4 else tgt('OTHER','non_purchase',None,None,'not_applicable','nincs vásárlási lifecycle esemény')
    return row('',decorate(email(f'news@{x["domain"]}',subj,body),i,split),ans,['v17.5',split,'targeted','nonpurchase-noise'])
def make_link(i,split):
    x=ids(i,split); v=i%6; alt=f'ALT-{700000+i}'
    cases=[(f'Rendelés: {x["order"]}\nCsomagszám: {x["tracking"]}\nA küldemény a fuvarozó hálózatában halad.',tgt('IN_TRANSIT','buyer',x['order'],x['tracking'],'linked','fuvarozó hálózatában halad')),(f'Csomagszám: {x["tracking"]}\nA küldemény a regionális központból továbbindult. Rendelési hivatkozás nem szerepel.',tgt('IN_TRANSIT','buyer',None,x['tracking'],'unresolved','regionális központból továbbindult')),(f'Csomagszám: {x["tracking"]}\nLehetséges rendelések: {x["order"]}, {alt}. Egyik kapcsolat sincs igazolva. A csomag depóban van.',tgt('IN_TRANSIT','buyer',None,x['tracking'],'unresolved','kapcsolat sincs igazolva')),(f'Rendelés: {x["order"]}\nA raktár összekészíti a tételeket; futárnak még nem adták át.',tgt('ORDER_PROCESSING','buyer',x['order'],None,'linked','raktár összekészíti')),(f'Tranzakció: TX-{800000+i}\nA kártyás fizetés sikeres. Rendelési azonosító nincs az üzenetben.',tgt('PAYMENT','buyer',None,None,'unresolved','kártyás fizetés sikeres')),(f'Fiókbeállítás módosult. Súgópélda: {x["tracking"]}. Ez nem valós küldemény.',tgt('OTHER','non_purchase',None,None,'not_applicable','nem valós küldemény'))]
    body,ans=cases[v]; return row('',decorate(email('notice@service.example','Állapotértesítő',body),i,split),ans,['v17.5',split,'targeted','link-status'])
def make_invoice_payment(i,split):
    x=ids(i,split); v=i%4
    if v==0: body=f'Rendelés: {x["order"]}\nTranzakció: TX-{820000+i}\nA fizetés jóváhagyva és könyvelve.'; ans=tgt('PAYMENT','buyer',x['order'],None,'linked','fizetés jóváhagyva és könyvelve')
    elif v==1: body=f'Tranzakció: TX-{820000+i}\nA fizetés sikeresen lezárult. Rendelési azonosító nem szerepel.'; ans=tgt('PAYMENT','buyer',None,None,'unresolved','fizetés sikeresen lezárult')
    elif v==2: body=f'A {x["order"]} rendeléshez elkészült a számla. Számlaszám: INV-{830000+i}. A PDF csatolva.'; ans=tgt('INVOICE','buyer',x['order'],None,'linked','rendeléshez elkészült a számla')
    else: body=f'Számla kiállítva. Bizonylat: INV-{830000+i}. Rendelési azonosító nem található ebben az üzenetben.'; ans=tgt('INVOICE','buyer',None,None,'unresolved','Számla kiállítva')
    return row('',decorate(email('billing@provider.example','Pénzügyi értesítő',body),i,split),ans,['v17.5',split,'targeted','invoice-payment-link'])
def make_return_refund(i,split):
    x=ids(i,split); v=i%6
    if v==0: body=f'Rendelés: {x["order"]}\nA visszatérítési kérelmedet rögzítettük. Pénzmozgás még nem történt.'; ans=tgt('OTHER','buyer',x['order'],None,'linked','visszatérítési kérelmet rögzítettük; pénzmozgás még nem történt')
    elif v==1: body=f'Rendelés: {x["order"]}\nA visszaküldési címke elkészült. A terméket még nem adtad át és a raktár sem vette át.'; ans=tgt('OTHER','buyer',x['order'],None,'linked','visszaküldési címke elkészült; termék még nincs visszaadva')
    elif v==2: body='Refund request accepted. No order reference is present and no money has been returned yet.'; ans=tgt('OTHER','buyer',None,None,'unresolved','no money has been returned yet')
    elif v==3: body=f'Rendelés: {x["order"]}\nA visszautalást teljesítettük az eredeti fizetési módra. Refund status: completed.'; ans=tgt('REFUNDED','buyer',x['order'],None,'linked','visszautalást teljesítettük')
    elif v==4: body=f'Rendelés: {x["order"]}\nA visszaküldött csomagot a raktár fizikailag átvette és ellenőrzésre betárolta.'; ans=tgt('RETURN','buyer',x['order'],None,'linked','raktár fizikailag átvette')
    else: body='A visszaküldött csomag beérkezett a raktárba. Rendelési azonosító nincs megadva.'; ans=tgt('RETURN','buyer',None,None,'unresolved','visszaküldött csomag beérkezett')
    return row('',decorate(email('returns@shop.example','Visszáru / refund értesítő',body),i,split),ans,['v17.5',split,'targeted','return-refund-boundary'])
def make_merchant(i,split):
    x=ids(i,split); v=i%4
    if v==0: body='Tisztelt Webshop Partner! Futárunk holnap az Ön telephelyéről gyűjti be a vevőinek feladandó csomagokat. Ez partneri pickup-tervezés, nem saját vásárlás.'; ans=tgt('OTHER','merchant_outbound',None,None,'not_applicable','partneri pickup-tervezés')
    elif v==1: body=f'Partnerküldemény. Vevői rendelés: {x["order"]}\nTracking: {x["tracking"]}\nA futár fizikailag átvette az Ön raktárából a vevőnek feladott csomagot.'; ans=tgt('SHIPPED','merchant_outbound',x['order'],x['tracking'],'linked','futár fizikailag átvette az Ön raktárából')
    elif v==2: body=f'Rendelés: {x["order"]}\nCsomagszám: {x["tracking"]}\nA megvásárolt csomagodat a futár átvette a kereskedőtől.'; ans=tgt('SHIPPED','buyer',x['order'],x['tracking'],'linked','megvásárolt csomagodat a futár átvette')
    else: body='Webshop partner riport: a mai begyűjtés 18 küldeményt érintett. Ez összesítő partnerüzenet, nem egy konkrét vásárlás.'; ans=tgt('OTHER','merchant_outbound',None,None,'not_applicable','összesítő partnerüzenet')
    return row('',decorate(email('partner@carrier.example','Partner értesítő',body),i,split),ans,['v17.5',split,'targeted','perspective'])
def make_idsafety(i,split):
    x=ids(i,split); v=i%5
    if v==0: body=f'Hírlevél. Kuponkód: {x["tracking"]}. A kód csak kedvezményre használható, nem csomagszám.'; ans=tgt('OTHER','non_purchase',None,None,'not_applicable','kuponkód; nem csomagszám')
    elif v==1: body=f'Rendelés: {x["order"]}\nA rendelést csomagoljuk.\n\n> Régi idézett levél: tracking OLD{770000000+i}, kézbesítve múlt hónapban.'; ans=tgt('ORDER_PROCESSING','buyer',x['order'],None,'linked','rendelést csomagoljuk')
    elif v==2: body=f'Jelenlegi tracking: {x["tracking"]}\nA korábbi hibás csomagszámot OLD{780000000+i} lecseréltük. A címke elkészült, fizikai átvétel még nincs.'; ans=tgt('SHIPMENT_CREATED','buyer',None,x['tracking'],'unresolved','címke elkészült; fizikai átvétel még nincs')
    elif v==3: body=f'Rendelés: {x["order"]}\nSzámlaszám: INV-{840000+i}\nÜgyfélszolgálati ügy: CASE-{850000+i}\nA rendelést rögzítettük.'; ans=tgt('ORDER_CREATED','buyer',x['order'],None,'linked','rendelést rögzítettük')
    else: body=f'Dokumentáció: példaként a {x["tracking"]} alakú azonosító szerepel. Ez nem valódi tracking és nincs hozzá rendelés.'; ans=tgt('OTHER','non_purchase',None,None,'not_applicable','nem valódi tracking')
    return row('',decorate(email('info@example.org','Azonosítóval kapcsolatos üzenet',body),i,split),ans,['v17.5',split,'targeted','id-safety'])
def make_retention(i,split):
    x=ids(i,split); ev=['ORDER_CREATED','ORDER_PROCESSING','CANCELLED','REFUNDED','RETURN','DELIVERED'][i%6]
    body_map={'ORDER_CREATED':f'Rendelés: {x["order"]}\nA megrendelést fogadtuk és rögzítettük. Feldolgozás ezután indul.','ORDER_PROCESSING':f'Rendelés: {x["order"]}\nA raktár összekészíti a tételeket; futárfelvétel még nem történt.','CANCELLED':f'Rendelés: {x["order"]}\nA megrendelést véglegesen töröltük, kiszállítás nem lesz.','REFUNDED':f'Rendelés: {x["order"]}\nA visszatérítés teljesült, az összeget az eredeti fizetési módra elküldtük.','RETURN':f'Rendelés: {x["order"]}\nA visszaküldött terméket a raktár fizikailag átvette.','DELIVERED':f'BuyFlow kapcsolat: {x["order"]} ↔ {x["tracking"]}.\nA címzett átvette a csomagot, kézbesítés lezárva.'}
    subj={'ORDER_CREATED':'Rendelés fogadva','ORDER_PROCESSING':'Raktári előkészítés','CANCELLED':'Rendelés törölve','REFUNDED':'Visszatérítés teljesítve','RETURN':'Visszáru beérkezett','DELIVERED':'Kézbesítés lezárva'}[ev]; evidence=body_map[ev].split('\n')[-1]; tracking=x['tracking'] if ev=='DELIVERED' else None
    return row('',decorate(email(f'noreply@{x["domain"]}',subj,body_map[ev]),i,split,ev if ev=='DELIVERED' else None),tgt(ev,'buyer',x['order'],tracking,'linked',evidence),['v17.5',split,'retention',f'event:{ev.lower()}'])
MAKERS={'lifecycle_boundary':make_lifecycle,'nonpurchase_noise':make_nonpurchase,'link_status':make_link,'invoice_payment':make_invoice_payment,'return_refund_boundary':make_return_refund,'merchant_outbound':make_merchant,'id_safety':make_idsafety,'retention':make_retention}
def build(split,counts):
    rows=[]; seq=0; offset=0
    for fam,n in counts.items():
        for j in range(n):
            r=MAKERS[fam](offset+j,split); seq+=1; r['id']=f'v175-{split}-{seq:04d}'; rows.append(r)
        offset+=10000
    rng.shuffle(rows); return rows
def norm_input(r): return re.sub(r'\s+',' ',next(m['content'] for m in r['messages'] if m['role']=='user')).strip().lower()
def validate(train,val):
    assert len(train)==2400 and len(val)==320
    for split,rows in [('train',train),('validation',val)]:
        seen=set(); ev=Counter(); ps=Counter(); lk=Counter()
        for r in rows:
            n=norm_input(r); assert n not in seen,f'duplicate {split}'; seen.add(n); a=json.loads(next(m['content'] for m in r['messages'] if m['role']=='assistant')); assert a['event_type'] in EVENTS and a['perspective'] in PERS and a['link_status'] in LINKS; user=next(m['content'] for m in r['messages'] if m['role']=='user')
            if a['order_id'] is not None: assert a['order_id'] in user
            if a['tracking_id'] is not None: assert a['tracking_id'] in user
            if a['perspective']=='non_purchase': assert a['event_type']=='OTHER'
            ev[a['event_type']]+=1; ps[a['perspective']]+=1; lk[a['link_status']]+=1
        print(split,'unique',len(seen),'events',dict(ev),'perspective',dict(ps),'link',dict(lk))
    assert not ({norm_input(r) for r in train}&{norm_input(r) for r in val}),'train-val overlap'; print('STRICT V17.5 VALIDATION: PASS | train-val overlap=0')
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def main():
    import argparse
    ap=argparse.ArgumentParser(); ap.add_argument('--out',default=str(Path.home()/'Desktop'/'buyflow-v17-5-targeted')); args=ap.parse_args(); out=Path(args.out); out.mkdir(parents=True,exist_ok=True); train=build('train',COUNTS_T); val=build('validation',COUNTS_V); validate(train,val); tp=out/'train.jsonl'; vp=out/'validation.jsonl'; tp.write_text('\n'.join(json.dumps(x,ensure_ascii=False,separators=(',',':')) for x in train)+'\n',encoding='utf-8'); vp.write_text('\n'.join(json.dumps(x,ensure_ascii=False,separators=(',',':')) for x in val)+'\n',encoding='utf-8'); th=sha(tp); vh=sha(vp); fp=hashlib.sha256((th+'\n'+vh+'\nV17.5-targeted-v1').encode()).hexdigest(); manifest={'name':'buyflow-v17-5-targeted-v1','seed':SEED,'train_rows':len(train),'validation_rows':len(val),'train_sha256':th,'validation_sha256':vh,'corpus_fingerprint':fp,'train_family_counts':COUNTS_T,'validation_family_counts':COUNTS_V,'source':'fresh synthetic contrastive families; Blind V4 examples are not read or copied','starting_adapter_recommendation':'buyflow-v17-3-gemma3-12b-qlora-r8-cont1','production':'OFF'}; (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print('='*62); print('BUYFLOW V17.5 TARGETED TEACHER DATASET: READY'); print('Output:',out); print('Train:',len(train),'Validation:',len(val)); print('train sha256:',th); print('validation sha256:',vh); print('corpus fingerprint:',fp); print('Blind V4: NOT READ / NOT COPIED'); print('Training: NOT STARTED'); print('Production: OFF'); print('='*62)
if __name__=='__main__': main()
