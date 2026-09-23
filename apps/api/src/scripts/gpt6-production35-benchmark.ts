import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId, requireOpenAIConfig } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const MODELS=['gpt-6-luna','gpt-6-sol','gpt-5.6-luna','gpt-5.6-sol'] as const;
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

function normalizeSubject(value:string|undefined){return (value??'').replace(/\s+/g,' ').trim().toLowerCase();}
function signature(subject:string|undefined,receivedAt:string){
  const ts=new Date(receivedAt).toISOString().slice(0,10);
  return createHash('sha256').update(normalizeSubject(subject)+'|'+ts,'utf8').digest('hex');
}
function core(x:any){return {event_type:x.event_type,shipment_phase:x.shipment_phase??null,order_number:x.order_number??null,tracking_number:x.tracking_number??null};}
function exact(a:Expected,b:Expected){return a.event_type===b.event_type&&a.shipment_phase===b.shipment_phase&&a.order_number===b.order_number&&a.tracking_number===b.tracking_number;}

async function main(){
  const openai=requireOpenAIConfig();
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const wanted=new Map<string,CaseDef[]>();
  for(const c of CASES){const group=wanted.get(c.signature)??[];group.push(c);wanted.set(c.signature,group);}
  const found=new Map<string,Awaited<ReturnType<typeof provider.getMessage>>>();
  let cursor:string|undefined;
  for(let pageNo=0;pageNo<20 && found.size<CASES.length;pageNo++){
    const page=await provider.searchMessages({query:'after:2026/07/28 before:2026/09/04',limit:200,...(cursor?{cursor}:{})});
    for(const item of page.messages){
      const group=wanted.get(signature(item.subject,item.receivedAt));
      const hit=group?.find(c=>!found.has(c.caseId));
      if(hit){found.set(hit.caseId,await provider.getMessage(item.providerMessageId));}
    }
    cursor=page.nextCursor;
    if(!cursor)break;
  }

  console.log('REAL35 PRODUCTION-PROMPT BENCHMARK START');
  console.log(JSON.stringify({matched:found.size,total:CASES.length,safety:{nylasReadsOnly:true,buyflowWrites:0,openaiStore:false,rawEmailOutput:false}}));
  if(found.size!==CASES.length){
    const missing=CASES.filter(c=>!found.has(c.caseId)).map(c=>c.caseId);
    console.log(JSON.stringify({missing}));
    throw new Error('REAL35_MESSAGES_NOT_FULLY_MATCHED');
  }

  const stats=Object.fromEntries(MODELS.map(m=>[m,{exact_core:0,event_type:0,shipment_phase:0,order_number:0,tracking_number:0,input_tokens:0,output_tokens:0,total_tokens:0,cached_input_tokens:0,failures:[] as string[]}])) as Record<string,any>;

  for(let i=0;i<CASES.length;i++){
    const c=CASES[i]!, email=found.get(c.caseId)!;
    const row:string[]=[];
    for(const model of MODELS){
      const obs=await extractMailLensObservation({email,apiKey:openai.apiKey,model});
      const got=core(obs.result.extraction);
      const s=stats[model];
      if(exact(got,c.expected))s.exact_core++;
      for(const k of ['event_type','shipment_phase','order_number','tracking_number'] as const)if(got[k]===c.expected[k])s[k]++;
      s.input_tokens+=obs.result.inputTokens??0;s.output_tokens+=obs.result.outputTokens??0;s.total_tokens+=obs.result.totalTokens??0;s.cached_input_tokens+=obs.result.cachedInputTokens??0;
      if(!exact(got,c.expected))s.failures.push(c.caseId);
      row.push(model+'='+(exact(got,c.expected)?'PASS':'FAIL'));
    }
    console.log(`[${String(i+1).padStart(2,'0')}/35] ${c.caseId} ${row.join(' ')}`);
  }

  console.log('REAL35 PRODUCTION-PROMPT BENCHMARK RESULT');
  console.log(JSON.stringify({total:CASES.length,definition:'exact current BuyFlow MailLens + openai-email-extractor production prompt; core fields only',models:Object.fromEntries(MODELS.map(m=>[m,{...stats[m],exact_core_pct:Number((100*stats[m].exact_core/CASES.length).toFixed(1)),event_type_pct:Number((100*stats[m].event_type/CASES.length).toFixed(1)),shipment_phase_pct:Number((100*stats[m].shipment_phase/CASES.length).toFixed(1))}])),safety:{nylasReadsOnly:true,buyflowWrites:0,openaiStore:false,rawEmailOutput:false}},null,2));
}
main().catch(e=>{console.error('REAL35 production benchmark failed:',e instanceof Error?e.message:'unknown');process.exit(1);});
