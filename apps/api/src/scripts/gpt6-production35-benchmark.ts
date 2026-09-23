import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId, requireOpenAIConfig } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const MODELS=['gpt-6-luna','gpt-6-sol','gpt-5.6-luna','gpt-5.6-sol'] as const;
type Expected={event_type:string;shipment_phase:string|null;order_number:string|null;tracking_number:string|null};
type CaseDef={caseId:string;signature:string;expected:Expected};

const CASES:CaseDef[]=[
['R120-002','37658bab2d6af57faaeb79ba77d84cc76bc4e787b84b602404958e492302dd5b',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
['R120-003','08ec08bcf1f3006e1b961715fd3ecd55a6dd3154e60a8df3db9fd1bf7889d4ad',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-005','7236b5786fd65d8ee11db8215123d18b19ea59e6aab090b04cfdca8f4159eb12',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-010','bb03f7f40d565c2f9c732fdeba3a4828d4b29734dd6040bc4f771c92f588600c',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-014','932587bb0a5b0c3e62ef5f06fcc6e78da088eb1d1ddae84b185fb39ae4845655',{event_type:'shipment',shipment_phase:'shipped',order_number:'2608319163',tracking_number:'2746595832'}],
['R120-015','b6f32cf414f248b8bebbfd44207679bef2056a03f93530f3b36091b3c99e23ef',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-018','949598cdd894d593d81d0ebf5a6911b45c2267dab232d9deee1300cfd71e68cf',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-019','f766d34f1743456e15d3d4be3eb9b8ad9517538f88062fdca84b5d169c4f8edb',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-020','f3d63ddb850819b32d3bb823c72a9fdb154754c9bf38764935ee2446c7285e55',{event_type:'order_updated',shipment_phase:null,order_number:'2608319163',tracking_number:null}],
['R120-021','a397b46b181aaec926b0029f9c38d87ef98a1a6808bca758c1ca1999a4c136a9',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-041','c5a81ef0e21053708b9c6afedf527a89b5c14e104b3c80b33d53ddc2af6dc0d8',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-043','9202e3d13e71d147a81f16143f1b6f13d1a097f06869bf022ed218f8c98f7e00',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-049','a4956f4265767443f1654d2093223492bdf8683f58d0855fee52f60149f89ef0',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-052','4789bce58200c095d88fc3bb4574233f32369ba81351b04346c2855a883aa7d0',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-054','61f3cadd6102b1d231f96d758a5c4fc0617317b6e6adbbf2ed1fb944e9ef134e',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-057','7d559c4940889683f16b0b00f7496a4d7cad21dcba5a41f21db112266a5e9c32',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-061','27778dd15224029ab00d1d20109da1691b36c2235dab813c41efa912cd7dc4e0',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-065','62f82b99ec7980dff3b7c592e96c5eae29fb24008038c98fa4a1f6941e6ba9e0',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-066','ab5ce0254b3215b9bec35e5ae9143ee381f83b1c9cfd523dadba00be5f0dda2e',{event_type:'invoice_or_receipt',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-067','6f636213597f3e6df7d2c08b4b2ddac1d52d19e8c3bcc46bfff008a81c610252',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-072','1db6f67814b2383dfa0eb64353f4e3b8018555cc30e6025a6ed4b51aee5595fb',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-074','d9d0932d92a43411a8648489c182e505cf41f15567eff721751746c1f79859c0',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
['R120-076','a615998d4e6edb250f940c0030b364d863c469dfa80a6324dc7d5de388ab375f',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-077','053ecd6ab7247d0a27ad005a1e44ab108408ced226c77507533a15bfe67d93da',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-084','1858ae3efd3f2c6a8631ae56fd3473c78904f91a9dea35f205449dde7d974906',{event_type:'subscription',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-085','41bd9f2de09b216ed17081df6ef3edc10d006593f9dbab13f89d838820a958c4',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:'16380143879559'}],
['R120-086','83729a39dbc93d45bed0942bf69fde0a5816eb250683eb24a11e813a9c820471',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-089','cc39fd1ab6b0796799b26a708273bb2bb523d271515233f071acb98c80c27e4c',{event_type:'shipment',shipment_phase:'out_for_delivery',order_number:null,tracking_number:'16380124260518'}],
['R120-090','1c49ead9c1fa4d52c5fc738ac9ddb2b818bfab51eca24d26d6ff481be6621037',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:'16380124260518'}],
['R120-096','d42de8cf3e69a7a9df7dff9c0666f7a81892e9b3a31163cb1c8cf705f41f4be2',{event_type:'shipment',shipment_phase:'shipment_created',order_number:null,tracking_number:'16380124260518'}],
['R120-106','c564bbe67260892fd5c3e0f58ec71c6428b9aae443ad8e4f0e4cf0bfadeb15c8',{event_type:'order_updated',shipment_phase:null,order_number:'192132',tracking_number:null}],
['R120-110','1fc9a195762e16e8e192e31a1a00e2c71b532bf858460efb7601eeb60455917f',{event_type:'payment_completed',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-113','9038f9674f75d26187c9851860c7d92f1f3b9c3335ebe828f5202f1fc61919e4',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-116','02474f5a5be6b78070b68e0f7cea280950427e2b6ed49f2356d71c50d37b5ca7',{event_type:'other',shipment_phase:null,order_number:null,tracking_number:null}],
['R120-119','6503676b6fcf1bb7807d261cbaf66807a3d6d05cbea63bd626748fd51fd696a2',{event_type:'shipment',shipment_phase:'shipped',order_number:null,tracking_number:null}],
].map(([caseId,signature,expected])=>({caseId,signature,expected})) as CaseDef[];

function normalizeSubject(value:string|undefined){return (value??'').replace(/\s+/g,' ').trim().toLowerCase();}
function signature(subject:string|undefined,receivedAt:string){
  const ts=new Date(receivedAt).toISOString().slice(0,19);
  return createHash('sha256').update(normalizeSubject(subject)+'|'+ts,'utf8').digest('hex');
}
function core(x:any){return {event_type:x.event_type,shipment_phase:x.shipment_phase??null,order_number:x.order_number??null,tracking_number:x.tracking_number??null};}
function exact(a:Expected,b:Expected){return a.event_type===b.event_type&&a.shipment_phase===b.shipment_phase&&a.order_number===b.order_number&&a.tracking_number===b.tracking_number;}

async function main(){
  const openai=requireOpenAIConfig();
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const wanted=new Map(CASES.map(c=>[c.signature,c]));
  const found=new Map<string,Awaited<ReturnType<typeof provider.getMessage>>>();
  let cursor:string|undefined;
  for(let pageNo=0;pageNo<20 && found.size<CASES.length;pageNo++){
    const page=await provider.searchMessages({query:'after:2026/07/28 before:2026/09/04',limit:200,...(cursor?{cursor}:{})});
    for(const item of page.messages){
      const hit=wanted.get(signature(item.subject,item.receivedAt));
      if(hit&&!found.has(hit.caseId)){
        found.set(hit.caseId,await provider.getMessage(item.providerMessageId));
      }
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
