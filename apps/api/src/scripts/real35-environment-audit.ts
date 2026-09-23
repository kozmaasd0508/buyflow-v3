import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { prepareDeterministicEvidence } from '../email/deterministic-evidence.js';
import { classifyEmailSenderRole } from '../email/sender-role.js';

type Expected={event_type:string;shipment_phase:string|null;order_number:string|null;tracking_number:string|null};
type CaseDef={caseId:string;signature:string;expected:Expected};

const CASES:CaseDef[]=[
['R120-002','bea5da5f7aae305f4150bc8f31354bfe3c6fa29fdf47ab83669bb1e2a5fd3f97',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
['R120-003','815c6e3af0d87f67bb664cd965ceaeae9a025d3cdc704545da537bdd0ae50a43',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-005','0bd6c066aeaa37607efb7ef2f4696bb72cbbfffe2d0d3782e2e6d117a72a3cfa',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-010','48bf8a06355f21c5a4759ca9baa8dfa190f0803b9c92db7cc79ed48a649dc9d6',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-014','f4243c3df1ec9473f7420034508514e09ce193cfd3bfc8c3a5d4ce1585e93eda',{event_type:'shipment',shipment_phase:'shipped',order_number:'2608319163',tracking_number:'2746595832'}],
['R120-015','46cb06d729e776fdadb3dfe28ee7384396661a2c37925cc4560ae950ba5a85fd',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-018','39001b9b9d2311f8fb6da445e125705141d0c7afa8d712c7f31bffaa426d3237',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-019','a0a032a46fe4cb1cc2f7eec39fec56e0f35dc5bb8f26a8ff06a8ec254e184f67',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-020','e21f8df7a298a126d18d6fd268277b2664f993bf25f7df1e61f378fad77b1529',{event_type:'order_updated',shipment_phase:null,order_number:'2608319163',tracking_number:null}],
['R120-021','17bca5d88dab809ec60315d78e4e10b6509bef7884565a0913d1cfbc7306b158',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-041','255ac2a32bfd544d8be2df37de9c0a9b2a0850ff33c0e02f2f47fc43cf22e2c6',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-043','9b694d2ed468ea717d36f147df2e10689b897b2c701dc26aca6e2749e6639f1e',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-049','479930818ec9652027c11bafbfe0efec4d19029f841b7fec1260a37767f43eba',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-052','16adc59e49b93fca8df9ce7d25f1d80328efe1f241aeafe8214b540d6f8384bb',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-054','a74eef30058ae05438e5c49830ef84626f98273cf8d9287d19a10960900c2949',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-057','8c887a78e258eb4b0c639bd936029e121f0354f2fc1168c284e797b0ac60bbad',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-061','04ced19f75d1525832a47069f28b0828717dbe8acf0c61dc58b23ea2f62aa990',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-065','4abe9a6564650c8a2f6b4954056823dd9f800ca4703581b09c132ad6df230919',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-066','a838fd73aff4f127a33609e73a07b5e31ff2bccf3d44d6fddb2ed5dfb2cb9d1e',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-067','4abe9a6564650c8a2f6b4954056823dd9f800ca4703581b09c132ad6df230919',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-072','6f9f107ebc6fb90ebf7c00b3a731db4a5f021446cb875d2f41df8af7178f6683',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-074','17c044b3c0780e102c9b5da496d5cad685672b4111f2d352c79c38ba6e937c55',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
['R120-076','cb2c0a1dc62a5e99810985f7ec17444a9dc09ce2c31cc3105a488cf71fcc0abf',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-077','f5634a88d20c4546393a1f44989f39cdc374c0aa606b0715d8329e7e648e236a',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-084','6393ee911ca3829c4b2c32ad8d99e863beb5118fd1f4423442f890138259045b',{event_type:'subscription',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-085','4dbd2c85c982518235009536b10fa66315e28102841a02190945a197b7baafa7',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:'16380143879559'}],
['R120-086','05e4b1370cdd04c7f3ffbde5266cc18ef1434bf8a34e36e62b30e751936db8d2',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-089','11335bc193304a2e564eb785a0d4eb7f4ca0f3a4fe586392456a2613fef0231d',{event_type:'shipment',shipment_phase:'out_for_delivery',order_number:null,tracking_number:'16380124260518'}],
['R120-090','1c1c778aefc4dc4c3163ee349e5f112e1eda4b5b58c157d750fc64b15a52cf45',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:'16380124260518'}],
['R120-096','def80cf0694010a3ce6121f1ad4568126b1d08d74a95e590ecb71deb1952a414',{event_type:'shipment',shipment_phase:'shipment_created',order_number:null,tracking_number:'16380124260518'}],
['R120-106','22ab3b077eb8addf8097c06e36766b98a3e904c287a0c1e0888a669445b1878d',{event_type:'order_updated',shipment_phase:null,order_number:'192132',tracking_number:null}],
['R120-110','c638f96a6e0771c1b0de955b0ea0f322b142b8e44cfa20d458e9b6230fe9dcd4',{event_type:'payment_completed',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-113','291b2d1ae93007ff40d32d98283566bc077f12cc9305447815dee06c0d35d3a1',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-116','f3d87b5d820815b55ae816362598543f1f3a08d767ac32feb384304f3018b2be',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-119','caec8b872fb07d71d32ce2ef720cbd10f9002616a85693c979e8fccaca1d8431',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
].map(([caseId,signature,expected])=>({caseId,signature,expected})) as CaseDef[];

const CARRIER_EVENTS=new Set(['shipment','delivery','invoice_or_receipt','return','refund','other']);
function normalizeSubject(value:string|undefined){return (value??'').replace(/\s+/g,' ').trim().toLowerCase();}
function signature(subject:string|undefined,receivedAt:string){
  const day=new Date(receivedAt).toISOString().slice(0,10);
  return createHash('sha256').update(normalizeSubject(subject)+'|'+day,'utf8').digest('hex');
}
function canon(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,'');}
function appears(haystack:string,value:string|null){return value===null||canon(haystack).includes(canon(value));}
function extractCandidates(text:string,patterns:RegExp[]){
  const out=new Set<string>();
  for(const pattern of patterns){
    for(const m of text.matchAll(pattern)){
      const v=(m[1]??'').replace(/\s+/g,' ').trim().replace(/[|,.;:]+$/,'');
      if(v.length>=3&&v.length<=48)out.add(v);
    }
  }
  return [...out];
}
const ORDER_PATTERNS=[
  /(?:rendelésszám|megrendelésszám|order\s*(?:number|id))\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,47})/giu,
  /([A-Z0-9][A-Z0-9._\/-]{2,47})\s+számú\s+(?:rendelés|megrendelés)/giu,
];
const TRACK_PATTERNS=[
  /(?:nyomkövetési\s+kód|tracking\s*(?:number|id)|küldemény\s+azonosítója|csomagszám)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,47})/giu,
  /(?:csomag(?:ja)?\s+)?Z-szám(?:át)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,47})/giu,
];
function hasExplicitPaymentCompletion(text:string){
  return /(?:sikeres(?:en)?\s+(?:bankkártyás\s+)?fizet|fizetés\w*\s+sikeres|payment\s+(?:was\s+)?(?:successful|completed)|paid\s+successfully|minden\s+kifizetve)/iu.test(text);
}
function hasFutureCarrierHandoff(text:string){
  return /(?:hamarosan|rövidesen|soon).{0,90}(?:szállító|futár|carrier).{0,90}(?:kezébe\s+kerül|átad|handoff|handed)/isu.test(text)
    || /(?:vár(?:ja|juk)?|waiting).{0,90}(?:futár|carrier).{0,90}(?:felvétel|pickup|átvétel)/isu.test(text);
}
function boilerplateStats(text:string){
  const markers=[/\nÁLTALÁNOS SZERZŐDÉSI FELTÉTELEK\n/iu,/\nGENERAL TERMS AND CONDITIONS\n/iu,/\nTERMS AND CONDITIONS\n/iu];
  let idx=-1;
  for(const re of markers){const m=re.exec(text);if(m&&m.index>idx)idx=m.index;}
  return idx>=0?{present:true,start:idx,charsAfter:text.length-idx}:{present:false,start:null,charsAfter:0};
}

async function main(){
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const wanted=new Map<string,CaseDef[]>();
  for(const c of CASES){const g=wanted.get(c.signature)??[];g.push(c);wanted.set(c.signature,g);}
  const found=new Map<string,Awaited<ReturnType<typeof provider.getMessage>>>();
  let cursor:string|undefined;
  for(let pageNo=0;pageNo<20&&found.size<CASES.length;pageNo++){
    const page=await provider.searchMessages({query:'after:2026/07/28 before:2026/09/04',limit:200,...(cursor?{cursor}:{})});
    for(const item of page.messages){
      const group=wanted.get(signature(item.subject,item.receivedAt));
      const hit=group?.find(c=>!found.has(c.caseId));
      if(hit)found.set(hit.caseId,await provider.getMessage(item.providerMessageId));
    }
    cursor=page.nextCursor;if(!cursor)break;
  }
  if(found.size!==CASES.length){
    console.log(JSON.stringify({matched:found.size,total:CASES.length,missing:CASES.filter(c=>!found.has(c.caseId)).map(c=>c.caseId)}));
    throw new Error('REAL35_MESSAGES_NOT_FULLY_MATCHED');
  }

  const rows:any[]=[];
  for(const c of CASES){
    const email=found.get(c.caseId)!;
    const ev=prepareDeterministicEvidence(email,20_000);
    const fromDomains=[...new Set(email.from.map(a=>a.email.trim().toLowerCase()).filter(x=>x.includes('@')).map(x=>x.slice(x.lastIndexOf('@')+1)).filter(Boolean))];
    const role=classifyEmailSenderRole(fromDomains);
    const text=[ev.subject??'',ev.bodyText].join('\n');
    const orderCandidates=extractCandidates(text,ORDER_PATTERNS);
    const trackingCandidates=extractCandidates(text,TRACK_PATTERNS);
    const warnings:string[]=[];
    if(ev.normalization.semanticTextTruncated)warnings.push('semantic_truncated');
    if(ev.normalization.bodyTextSource==='snippet_fallback')warnings.push('snippet_only');
    if(!ev.bodyText.trim())warnings.push('empty_semantic_evidence');
    if(role==='carrier'&&!CARRIER_EVENTS.has(c.expected.event_type))warnings.push('gold_event_blocked_by_carrier_schema');
    if(role==='carrier'&&c.expected.order_number!==null)warnings.push('gold_order_blocked_by_carrier_schema');
    if(!appears(text,c.expected.order_number))warnings.push('gold_order_not_in_evidence');
    if(!appears(text,c.expected.tracking_number))warnings.push('gold_tracking_not_in_evidence');
    if(role!=='carrier'&&c.expected.order_number===null&&orderCandidates.length)warnings.push('gold_missing_explicit_order_candidate');
    if(c.expected.tracking_number===null&&trackingCandidates.length)warnings.push('gold_missing_explicit_tracking_candidate');
    if(c.expected.event_type==='payment_completed'&&!hasExplicitPaymentCompletion(text))warnings.push('payment_completion_not_explicit');
    if(['shipped','in_transit'].includes(c.expected.shipment_phase??'')&&hasFutureCarrierHandoff(text))warnings.push('phase_conflicts_future_carrier_handoff');
    const urls=[...ev.bodyText.matchAll(/https?:\/\/[^\s)\]]+/giu)].map(m=>m[0]!);
    const urlChars=urls.reduce((n,u)=>n+u.length,0);
    const bp=boilerplateStats(ev.bodyText);
    if(bp.present&&bp.charsAfter>3000)warnings.push('large_legal_boilerplate_tail');
    rows.push({
      caseId:c.caseId,role,source:ev.normalization.bodyTextSource,
      semanticChars:ev.bodyText.length,semanticTruncated:ev.normalization.semanticTextTruncated,
      quotedHistory:ev.normalization.quotedHistoryDetected,urlCount:urls.length,urlChars,
      boilerplateCharsAfter:bp.charsAfter,
      orderCandidateCount:orderCandidates.length,trackingCandidateCount:trackingCandidates.length,
      warnings,
    });
  }
  const warningCounts:Record<string,number>={};
  for(const r of rows)for(const w of r.warnings)warningCounts[w]=(warningCounts[w]??0)+1;
  console.log('REAL35 ENVIRONMENT AUDIT (NO OPENAI CALLS)');
  console.log(JSON.stringify({
    total:rows.length,
    safety:{openaiCalls:0,buyflowWrites:0,nylasReadsOnly:true,rawEmailOutput:false},
    summary:{
      carrier:rows.filter(r=>r.role==='carrier').length,
      truncated:rows.filter(r=>r.semanticTruncated).length,
      snippetOnly:rows.filter(r=>r.source==='snippet_fallback').length,
      totalSemanticChars:rows.reduce((n,r)=>n+r.semanticChars,0),
      totalUrlChars:rows.reduce((n,r)=>n+r.urlChars,0),
      warningCounts,
    },
    cases:rows.filter(r=>r.warnings.length).map(r=>({caseId:r.caseId,role:r.role,source:r.source,semanticChars:r.semanticChars,urlCount:r.urlCount,urlChars:r.urlChars,boilerplateCharsAfter:r.boilerplateCharsAfter,warnings:r.warnings}))
  },null,2));
}
main().catch(e=>{console.error('REAL35 environment audit failed:',e instanceof Error?e.message:'unknown');process.exit(1);});
