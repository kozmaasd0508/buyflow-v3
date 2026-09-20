import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const SEED='buyflow-maillens-real30-2026-09-20-v1';
const QUERY='category:purchases newer_than:60d -in:spam -in:trash';
const MODELS=['gpt-5.6-luna','gpt-5.6-sol'] as const;
const FIELDS=['event_type','shipment_phase','order_number','tracking_number','invoice_number','payment_status'] as const;

type Model=typeof MODELS[number];
type Gold={
  event_type:string;
  shipment_phase:string|null;
  order_hash:string|null;
  tracking_hash:string|null;
  invoice_hash:string|null;
  payment_status:string|null;
};

const H=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const GOLD:Gold[]=[
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'5819ea0489e2309c8252e06cf4fe6507c357baec7903bf4404b83d71421dfa53',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'505ba4be36e506edea116902175327b986958e33ab7aedf381b0826d676f752b',invoice_hash:null,payment_status:null},
  {event_type:'delivery',shipment_phase:'delivered',order_hash:null,tracking_hash:'dc3d9696d5136e7654e5253edd14451bbf7c2b689f52ca870cbf6574e927ae38',invoice_hash:null,payment_status:null},
  {event_type:'payment_completed',shipment_phase:null,order_hash:'9e2496ce96a83f10f1366352dd38744be68466a85fd4b100686534325d57ffdf',tracking_hash:null,invoice_hash:null,payment_status:'paid'},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'5819ea0489e2309c8252e06cf4fe6507c357baec7903bf4404b83d71421dfa53',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'c2ac01c5daea7a0481fbabf120b9e254aff8073d8e6d0fec0cfa8f4870b7e625',invoice_hash:null,payment_status:null},
  {event_type:'order_updated',shipment_phase:null,order_hash:'2ca93c76b0c5a5dc564e9bc6e5f0d8c8a805674887971130594774445acff524',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'3abe688dc7479e28d19b5129a8475130dbfe8fbb008cf325be8bc614a07e3729',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:'ba52a7bb3032947c29e4c6e4ed260fb0ebc6bdb18dadcfc96993e30524ca6617',tracking_hash:null,invoice_hash:'a1ff4572c43936482872f5ccdf24f801dc3ba5c00aef82e9d3cb98c6abb0e70e',payment_status:'paid'},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'61f886bddf84915acd518a7f64ef4aa93688a4d56a207b6f59d06a01012ff206',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'f628562bddf9141fbd70534de72f40c534d488ed782db6a7bf2ccc6369053b2b',invoice_hash:null,payment_status:null},
  {event_type:'order_updated',shipment_phase:null,order_hash:'6c4600fbdee15274097ecbf2286f992e547a94118bfa0fec32524889bd32d24f',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'ready_for_pickup',order_hash:null,tracking_hash:'b596918aad998add0c67573e4348bfe018c4bb3f14bbf208ff83ee37ccf704d5',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'f20245da2f8fa514717dab84772c4f2593cd5d1254e388c9653964f6ecfd0f11',invoice_hash:null,payment_status:null},
  {event_type:'delivery',shipment_phase:'delivered',order_hash:null,tracking_hash:'5819ea0489e2309c8252e06cf4fe6507c357baec7903bf4404b83d71421dfa53',invoice_hash:null,payment_status:null},
  {event_type:'payment_completed',shipment_phase:null,order_hash:'3930d62516297b54207ea43fb9b83d06041e1882e206c1bf437f0e67393dda39',tracking_hash:null,invoice_hash:null,payment_status:'paid'},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'af136dd3ced013aad18a4a767c82a6c36f94bcc6734db3a1213a63800bc6edb4',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'ready_for_pickup',order_hash:null,tracking_hash:'f33f59e5c9c1822d616ee54e23ce1ff3db5283163b2f9f0b5560c133d24202ad',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'770b90d876e186174bbb7f0a3ca616f1ac27c24f38b6de7aac2be21d6733ceea',tracking_hash:'f33f59e5c9c1822d616ee54e23ce1ff3db5283163b2f9f0b5560c133d24202ad',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_created',shipment_phase:null,order_hash:'fb8141d73b7056a0a7dc578d0890161d846424e9dc98dc0e50c30e5245beb818',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'3a0765830a378a7f625ed28d996c37618c818fdfc3f6d6e5210809e925e3b42f',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_updated',shipment_phase:null,order_hash:'56c1b52704dad7bf126b970878593341983de81021196461e1bbc20c4808fc05',tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'c6d8dd466749eedfcf647439ffd65b37cb8c74655f09ed9ed667e4fbc7a0fb56',tracking_hash:'5819ea0489e2309c8252e06cf4fe6507c357baec7903bf4404b83d71421dfa53',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'6c4600fbdee15274097ecbf2286f992e547a94118bfa0fec32524889bd32d24f',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'3210b7a0a6bfdb2167efb7bf9e306b66b06ba884f6df6efe1915ed493dba3c38',invoice_hash:null,payment_status:null},
];

function hashOrNull(v:string|null|undefined){return v?H(v):null;}
function pct(n:number,d:number){return d?Number((n/d*100).toFixed(1)):0;}

async function main(){
  if(GOLD.length!==30) throw new Error('GOLD_COUNT_INVALID');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const page=await provider.searchMessages({query:QUERY,limit:200});
  const ranked=[...page.messages].sort((a,b)=>H(SEED+'\n'+a.providerMessageId).localeCompare(H(SEED+'\n'+b.providerMessageId)));
  const seen=new Set<string>(); const selected=[] as typeof ranked;
  for(const m of ranked){
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(seen.has(t)) continue; seen.add(t); selected.push(m);
    if(selected.length===30) break;
  }
  if(selected.length!==30) throw new Error('SELECTION_COUNT_INVALID');

  const scores:Record<Model,{exact:number;semanticExact:number;identityExact:number;field:Record<string,number>;errors:number}>={} as any;
  for(const model of MODELS) scores[model]={exact:0,semanticExact:0,identityExact:0,field:Object.fromEntries(FIELDS.map(f=>[f,0])),errors:0};
  const rows:any[]=[];

  for(let i=0;i<30;i++){
    const listed=selected[i]!;
    const email=await provider.getMessage(listed.providerMessageId);
    const g=GOLD[i]!;
    const row:any={case:i+1};
    for(const model of MODELS){
      try{
        const r=await extractMailLensObservation({email,apiKey,model});
        const x=r.result.extraction;
        const actual={
          event_type:x.event_type,
          shipment_phase:x.shipment_phase??null,
          order_number:hashOrNull(x.order_number),
          tracking_number:hashOrNull(x.tracking_number),
          invoice_number:hashOrNull(x.invoice_number),
          payment_status:x.payment_status??null,
        };
        const expected={
          event_type:g.event_type,
          shipment_phase:g.shipment_phase,
          order_number:g.order_hash,
          tracking_number:g.tracking_hash,
          invoice_number:g.invoice_hash,
          payment_status:g.payment_status,
        };
        const failed:string[]=[];
        for(const f of FIELDS){
          if(actual[f]===expected[f]) scores[model].field[f]!++;
          else failed.push(f);
        }
        const exact=failed.length===0;
        const semantic=actual.event_type===expected.event_type && actual.shipment_phase===expected.shipment_phase;
        const identity=actual.order_number===expected.order_number && actual.tracking_number===expected.tracking_number && actual.invoice_number===expected.invoice_number;
        if(exact) scores[model].exact++;
        if(semantic) scores[model].semanticExact++;
        if(identity) scores[model].identityExact++;
        row[model]={exact,semantic,identity,failed};
      }catch{
        scores[model].errors++;
        row[model]={technicalError:true};
      }
    }
    rows.push(row);
  }

  const summary:any={
    benchmark:'buyflow-real30-human-gold-v1',
    selectionSha256:H(selected.map(x=>x.providerMessageId).join('\n')),
    goldCount:30,
    safety:{databaseWrites:false,rawBodiesOutput:false,subjectsOutput:false,identifiersOutput:false,openAIStore:false},
    models:{},
    cases:rows,
  };
  for(const model of MODELS){
    const s=scores[model];
    summary.models[model]={
      exact:{count:s.exact,pct:pct(s.exact,30)},
      semanticExact:{count:s.semanticExact,pct:pct(s.semanticExact,30)},
      identityExact:{count:s.identityExact,pct:pct(s.identityExact,30)},
      fieldAccuracy:Object.fromEntries(FIELDS.map(f=>[f,{count:s.field[f] ?? 0,pct:pct(s.field[f] ?? 0,30)}])),
      technicalErrors:s.errors,
    };
  }
  console.log(JSON.stringify(summary,null,2));
}

main().catch(e=>{console.error('REAL30_HUMAN_GOLD_FATAL:',e instanceof Error?e.message:String(e));process.exit(1);});
