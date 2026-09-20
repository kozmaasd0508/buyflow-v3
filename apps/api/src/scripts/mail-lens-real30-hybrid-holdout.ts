import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractWithSelectiveSolVerification } from '../ai/selective-email-observation.js';

const QUERY='category:purchases newer_than:60d -in:spam -in:trash';
const PRIOR_SEED='buyflow-maillens-real30-2026-09-20-v1';
const HOLDOUT_SEED='buyflow-maillens-holdout30-2026-09-20-v1';
const EXPECTED='23b021c848e9e1e48d4e6ffda7436f8fe81c3ec2f31ad9a10623b449cd37dc1d';
const FIELDS=['event_type','shipment_phase','order_number','tracking_number','invoice_number','payment_status'] as const;
const H=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');

type Gold={
  event_type:string;
  shipment_phase:string|null;
  order_hash:string|null;
  tracking_hash:string|null;
  invoice_hash:string|null;
  payment_status:string|null;
};

const GOLD:Gold[]=[
  {event_type:'shipment',shipment_phase:'shipped',order_hash:'26858778c7cd462fbc7fb48d95f808de791d82873f04d6b7c40b47db4c52f2fd',tracking_hash:'f20245da2f8fa514717dab84772c4f2593cd5d1254e388c9653964f6ecfd0f11',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'e48375f20333ce95861ab67c6912743edca51f8f3295b7bbcf7c656312516dfc',invoice_hash:null,payment_status:null},
  {event_type:'other',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'out_for_delivery',order_hash:null,tracking_hash:'318c0fc64a3f9d4db3bd8f4a8382668fb5dde2d911bbb3c4735ea47a53f443f0',invoice_hash:null,payment_status:null},
  {event_type:'shipment',shipment_phase:'shipment_created',order_hash:null,tracking_hash:'eab51c7c3617795e95099edfe9eaf7eae65d6edeaf1705abb4859788c2755b54',invoice_hash:null,payment_status:null},
  {event_type:'invoice_or_receipt',shipment_phase:null,order_hash:null,tracking_hash:null,invoice_hash:null,payment_status:null},
  {event_type:'order_created',shipment_phase:null,order_hash:'770b90d876e186174bbb7f0a3ca616f1ac27c24f38b6de7aac2be21d6733ceea',tracking_hash:null,invoice_hash:null,payment_status:'cash_on_delivery'},
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
];

function hashOrNull(v:string|null|undefined){return v?H(v):null;}
function pct(n:number,d:number){return d?Number((n/d*100).toFixed(1)):0;}

async function main(){
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const page=await provider.searchMessages({query:QUERY,limit:200});

  const priorRanked=[...page.messages].sort((a,b)=>H(PRIOR_SEED+'\n'+a.providerMessageId).localeCompare(H(PRIOR_SEED+'\n'+b.providerMessageId)));
  const priorThreads=new Set<string>();
  for(const m of priorRanked){
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(priorThreads.has(t)) continue;
    priorThreads.add(t);
    if(priorThreads.size===30) break;
  }

  const ranked=page.messages
    .filter(m=>!priorThreads.has(m.providerThreadId?.trim()||'message:'+m.providerMessageId))
    .sort((a,b)=>H(HOLDOUT_SEED+'\n'+a.providerMessageId).localeCompare(H(HOLDOUT_SEED+'\n'+b.providerMessageId)));
  const seen=new Set<string>(), selected=[] as typeof ranked;
  for(const m of ranked){
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(seen.has(t)) continue;
    seen.add(t); selected.push(m);
    if(selected.length===30) break;
  }

  const selectionSha256=H(selected.map(x=>x.providerMessageId).join('\n'));
  if(selected.length!==30||selectionSha256!==EXPECTED) throw new Error('SELECTION_MISMATCH:'+selectionSha256);

  const field=Object.fromEntries(FIELDS.map(f=>[f,0])) as Record<string,number>;
  let exact=0, semanticExact=0, identityExact=0, technicalErrors=0, solCalls=0;
  const reasonCounts:Record<string,number>={};
  const sourceCounts:Record<string,number>={};
  const rows:any[]=[];

  for(let i=0;i<30;i++){
    try{
      const email=await provider.getMessage(selected[i]!.providerMessageId);
      const r=await extractWithSelectiveSolVerification({
        email,apiKey,primaryModel:'gpt-5.6-luna',verifierEnabled:true,verifierModel:'gpt-5.6-sol',
      });
      if(r.aiCalls===2) solCalls++;
      for(const reason of r.verification.reasons) reasonCounts[reason]=(reasonCounts[reason]??0)+1;
      const src=r.primary.evidence.normalization.bodyTextSource;
      sourceCounts[src]=(sourceCounts[src]??0)+1;

      const x=r.selected.result.extraction, g=GOLD[i]!;
      const actual={
        event_type:x.event_type,
        shipment_phase:x.shipment_phase??null,
        order_number:hashOrNull(x.order_number),
        tracking_number:hashOrNull(x.tracking_number),
        invoice_number:hashOrNull(x.invoice_number),
        payment_status:x.payment_status??null,
      };
      const expected={
        event_type:g.event_type,shipment_phase:g.shipment_phase,order_number:g.order_hash,
        tracking_number:g.tracking_hash,invoice_number:g.invoice_hash,payment_status:g.payment_status,
      };
      const failed:string[]=[];
      for(const f of FIELDS){if(actual[f]===expected[f]) field[f]=(field[f]??0)+1;else failed.push(f);}
      const rowExact=failed.length===0;
      const semantic=actual.event_type===expected.event_type&&actual.shipment_phase===expected.shipment_phase;
      const identity=actual.order_number===expected.order_number&&actual.tracking_number===expected.tracking_number&&actual.invoice_number===expected.invoice_number;
      if(rowExact) exact++; if(semantic) semanticExact++; if(identity) identityExact++;
      rows.push({case:i+1,selectedModel:r.selectedModel,verified:r.aiCalls===2,reasons:r.verification.reasons,coreAgreement:r.verification.coreAgreement,exact:rowExact,semantic,identity,failed});
    }catch{
      technicalErrors++; rows.push({case:i+1,technicalError:true});
    }
  }

  console.log(JSON.stringify({
    benchmark:'buyflow-real30-selective-luna-sol-hybrid-v1',
    selectionSha256,
    routing:{lunaCalls:30,solCalls,solRatePct:pct(solCalls,30),reasonCounts},
    mailLens:{sourceCounts},
    result:{
      exact:{count:exact,pct:pct(exact,30)},
      semanticExact:{count:semanticExact,pct:pct(semanticExact,30)},
      identityExact:{count:identityExact,pct:pct(identityExact,30)},
      fieldAccuracy:Object.fromEntries(FIELDS.map(f=>[f,{count:field[f]??0,pct:pct(field[f]??0,30)}])),
      technicalErrors,
    },
    cases:rows,
  },null,2));
}

main().catch(e=>{console.error('HYBRID_HOLDOUT_FATAL:',e instanceof Error?e.message:String(e));process.exit(1);});
