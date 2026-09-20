import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const QUERY='category:purchases newer_than:60d -in:spam -in:trash';
const PRIOR_SEED='buyflow-maillens-real30-2026-09-20-v1';
const HOLDOUT_SEED='buyflow-maillens-holdout30-2026-09-20-v1';
const EXPECTED='23b021c848e9e1e48d4e6ffda7436f8fe81c3ec2f31ad9a10623b449cd37dc1d';
const H=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');

async function main(){
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const page=await provider.searchMessages({query:QUERY,limit:200});
  const priorRanked=[...page.messages].sort((a,b)=>H(PRIOR_SEED+'\n'+a.providerMessageId).localeCompare(H(PRIOR_SEED+'\n'+b.providerMessageId)));
  const priorThreads=new Set<string>();
  for(const m of priorRanked){const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;if(priorThreads.has(t))continue;priorThreads.add(t);if(priorThreads.size===30)break;}
  const ranked=page.messages.filter(m=>!priorThreads.has(m.providerThreadId?.trim()||'message:'+m.providerMessageId))
    .sort((a,b)=>H(HOLDOUT_SEED+'\n'+a.providerMessageId).localeCompare(H(HOLDOUT_SEED+'\n'+b.providerMessageId)));
  const seen=new Set<string>(), selected=[] as typeof ranked;
  for(const m of ranked){const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;if(seen.has(t))continue;seen.add(t);selected.push(m);if(selected.length===30)break;}
  const sha=H(selected.map(x=>x.providerMessageId).join('\n'));
  if(sha!==EXPECTED) throw new Error('SELECTION_MISMATCH:'+sha);
  const rows=[];
  for(let i=0;i<selected.length;i++){
    const email=await provider.getMessage(selected[i]!.providerMessageId);
    const {result,evidence}=await extractMailLensObservation({email,apiKey,model:'gpt-5.6-luna'});
    const x=result.extraction;
    rows.push({
      case:i+1,
      confidence:x.confidence,
      event_type:x.event_type,
      shipment_phase:x.shipment_phase??null,
      evidence_issues:x.evidence_issues??[],
      has_order:Boolean(x.order_number),
      has_tracking:Boolean(x.tracking_number),
      has_invoice:Boolean(x.invoice_number),
      body_chars:evidence.bodyText.length,
    });
  }
  console.log(JSON.stringify({benchmark:'holdout-luna-risk-probe-v1',rows},null,2));
}
main().catch(e=>{console.error('RISK_PROBE_FATAL:',e instanceof Error?e.message:String(e));process.exit(1);});
