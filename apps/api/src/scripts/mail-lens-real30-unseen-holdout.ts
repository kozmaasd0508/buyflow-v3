import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const QUERY='category:purchases newer_than:60d -in:spam -in:trash';
const PRIOR_SEED='buyflow-maillens-real30-2026-09-20-v1';
const HOLDOUT_SEED='buyflow-maillens-holdout30-2026-09-20-v1';
const EXPECTED_HOLDOUT_SELECTION_SHA256='66288373dbbed6b3eec596150a566a7bd6f9cd5fed1a5a605c036cc0406e50c5';
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
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'26858778c7cd462fbc7fb48d95f808de791d82873f04d6b7c40b47db4c52f2fd',tracking_hash:'f20245da2f8fa514717dab84772c4f2593cd5d1254e388c9653964f6ecfd0f11',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'e48375f20333ce95861ab67c6912743edca51f8f3295b7bbcf7c656312516dfc',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'318c0fc64a3f9d4db3bd8f4a8382668fb5dde2d911bbb3c4735ea47a53f443f0',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'eab51c7c3617795e95099edfe9eaf7eae65d6edeaf1705abb4859788c2755b54',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_updated',shipment_phase:null,order_hash:'9ab245175cca1cefe9b5a61c1f71bdfe6d7ad1ea25cb7eece3ff546999da92f4',tracking_hash:'768c9bffb89da8db015fb8f5da70ed62adfb74778dfd7ccaad277805b53e3768',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'56c1b52704dad7bf126b970878593341983de81021196461e1bbc20c4808fc05',tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_created',shipment_phase:null,order_hash:'6bc0652deba50511a3f3d4ee85e59235162c0a3914bd8693a7ddbaaabf819bec',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'shipped',order_hash:null,tracking_hash:'c332ae7e93fb7ef057a1999637cb526f0ff4d1e8858c350fc06b9e323d71ed50',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'768c9bffb89da8db015fb8f5da70ed62adfb74778dfd7ccaad277805b53e3768',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'dc76ce685e0c3841567e378175c965ad6fdcf73170da4282456c74422a79b1e6',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'2ee71468d6d2a0057f06e10434872c6147f586f121d7d7e23a2cbe9b095483c1',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'154001fd0e455dd726d6d35a1cd9c78d55e0d1156a946b949a1db4b95da322ad',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'3a0765830a378a7f625ed28d996c37618c818fdfc3f6d6e5210809e925e3b42f',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_created',shipment_phase:null,order_hash:'6c4600fbdee15274097ecbf2286f992e547a94118bfa0fec32524889bd32d24f',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'fc8c6b18f9f42013e196cde428dce62e7cd654c30a9c240c39fec16ab4428a00',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'ready_for_pickup',order_hash:null,tracking_hash:'52d8b8c1fbae5c2bd318c25bb5c10befb88b708ef1ab53c75f92966cf1d4344d',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:'394b699f9fd65f89bc7f1d43e36d4df9771d3b7505f273752a38fff26d99bcaf',tracking_hash:null,invoice_hash:'9f9f042f7b11e728c1ecc6209e377535c1fcec0cd1f5fe199d7c14ffd9e9d25f',payment_status:'paid'},
  {event_type:'shipment',shipment_phase:'ready_for_pickup',order_hash:null,tracking_hash:'f20245da2f8fa514717dab84772c4f2593cd5d1254e388c9653964f6ecfd0f11',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_updated',shipment_phase:null,order_hash:'ba52a7bb3032947c29e4c6e4ed260fb0ebc6bdb18dadcfc96993e30524ca6617',tracking_hash:'dc3d9696d5136e7654e5253edd14451bbf7c2b689f52ca870cbf6574e927ae38',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:'9d76a4a48e8fc7355814c445bf12f27f90bf259f38e7aee6dd89970d34623c45',tracking_hash:null,invoice_hash:'1d8423a34e08f0a4e0a013d128a22acc34fe6d033de4a4cd9175112d632f95dc',payment_status:'paid'},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
];

function hashOrNull(v:string|null|undefined){return v?H(v):null;}
function pct(n:number,d:number){return d?Number((n/d*100).toFixed(1)):0;}

async function main(){
  if(GOLD.length!==30) throw new Error('GOLD_COUNT_INVALID');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const page=await provider.searchMessages({query:QUERY,limit:200});

  const priorRanked=[...page.messages].sort((a,b)=>
    H(PRIOR_SEED+'\n'+a.providerMessageId).localeCompare(H(PRIOR_SEED+'\n'+b.providerMessageId)));
  const priorThreads=new Set<string>(); const prior=[] as typeof priorRanked;
  for(const m of priorRanked){
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(priorThreads.has(t)) continue;
    priorThreads.add(t); prior.push(m);
    if(prior.length===30) break;
  }

  const holdoutRanked=page.messages
    .filter(m=>!priorThreads.has(m.providerThreadId?.trim()||'message:'+m.providerMessageId))
    .sort((a,b)=>H(HOLDOUT_SEED+'\n'+a.providerMessageId).localeCompare(H(HOLDOUT_SEED+'\n'+b.providerMessageId)));

  const seen=new Set<string>(); const selected=[] as typeof holdoutRanked;
  for(const m of holdoutRanked){
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(seen.has(t)) continue;
    seen.add(t); selected.push(m);
    if(selected.length===30) break;
  }

  if(selected.length!==30) throw new Error('HOLDOUT_SELECTION_COUNT_INVALID');
  const selectionSha256=H(selected.map(x=>x.providerMessageId).join('\n'));
  if(selectionSha256!==EXPECTED_HOLDOUT_SELECTION_SHA256){
    console.log(JSON.stringify({ selectionProbe: selected.map((x,index)=>({case:index+1,messageHash:H(x.providerMessageId),threadHash:H(x.providerThreadId?.trim()||('message:'+x.providerMessageId))})), selectionSha256 }, null, 2));
    throw new Error('HOLDOUT_SELECTION_MISMATCH:'+selectionSha256);
  }

  const scores:Record<Model,{exact:number;semanticExact:number;identityExact:number;field:Record<string,number>;errors:number}>={} as any;
  for(const model of MODELS) scores[model]={exact:0,semanticExact:0,identityExact:0,field:Object.fromEntries(FIELDS.map(f=>[f,0])),errors:0};

  const sourceCounts:Record<string,number>={};
  let snippetFallback=0, bodyTruncated=0, semanticTruncated=0, emptyAuthoredBody=0;
  const rows:any[]=[];

  for(let i=0;i<30;i++){
    const listed=selected[i]!;
    const email=await provider.getMessage(listed.providerMessageId);
    const g=GOLD[i]!;
    const row:any={case:i+1};

    for(const model of MODELS){
      try{
        const r=await extractMailLensObservation({email,apiKey,model});
        const ev=r.evidence;
        if(model===MODELS[0]){
          const src=ev.normalization.bodyTextSource;
          sourceCounts[src]=(sourceCounts[src]??0)+1;
          if(src==='snippet_fallback') snippetFallback++;
          if(ev.normalization.bodyTextTruncated) bodyTruncated++;
          if(ev.normalization.semanticTextTruncated) semanticTruncated++;
          if(!ev.bodyText.trim()) emptyAuthoredBody++;
        }

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
          if(actual[f]===expected[f]) scores[model].field[f]=(scores[model].field[f]??0)+1;
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
    benchmark:'buyflow-real30-unseen-holdout-v1',
    promptVersion:'email-extraction-v2.3-logistics-boundaries',
    selection:{
      pool:page.messages.length,
      priorThreadsExcluded:priorThreads.size,
      selectionSha256,
      unseenByThread:true,
      contentBlindSelection:true,
    },
    safety:{databaseWrites:false,rawBodiesOutput:false,subjectsOutput:false,identifiersOutput:false,providerMessageIdsOutput:false,openAIStore:false},
    mailLens:{sourceCounts,snippetFallback,bodyTruncated,semanticTruncated,emptyAuthoredBody},
    models:{},
    cases:rows,
  };

  for(const model of MODELS){
    const s=scores[model];
    summary.models[model]={
      exact:{count:s.exact,pct:pct(s.exact,30)},
      semanticExact:{count:s.semanticExact,pct:pct(s.semanticExact,30)},
      identityExact:{count:s.identityExact,pct:pct(s.identityExact,30)},
      fieldAccuracy:Object.fromEntries(FIELDS.map(f=>[f,{count:s.field[f]??0,pct:pct(s.field[f]??0,30)}])),
      technicalErrors:s.errors,
    };
  }

  console.log(JSON.stringify(summary,null,2));
}

main().catch(e=>{console.error('REAL30_UNSEEN_HOLDOUT_FATAL:',e instanceof Error?e.message:String(e));process.exit(1);});
