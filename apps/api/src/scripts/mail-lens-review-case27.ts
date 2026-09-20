import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { extractMailLensObservation } from '../ai/mail-lens-observation.js';

const SEED='buyflow-maillens-real30-2026-09-20-v1';
const QUERY='category:purchases newer_than:60d -in:spam -in:trash';

async function main() {
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const provider=createEmailProvider({provider:'nylas',providerAccountId:requireNylasSmokeGrantId()});
  const page=await provider.searchMessages({query:QUERY,limit:200});
  const ranked=[...page.messages].sort((a,b)=>
    createHash('sha256').update(SEED+'\n'+a.providerMessageId).digest('hex')
      .localeCompare(createHash('sha256').update(SEED+'\n'+b.providerMessageId).digest('hex')));
  const seen=new Set<string>(); const selected=ranked.filter(m=>{
    const t=m.providerThreadId?.trim()||'message:'+m.providerMessageId;
    if(seen.has(t)) return false; seen.add(t); return true;
  }).slice(0,30);
  const listed=selected[26]; if(!listed) throw new Error('CASE27_MISSING');
  const email=await provider.getMessage(listed.providerMessageId);
  const out:any={case:27};
  for(const model of ['gpt-5.6-luna','gpt-5.6-sol']) {
    const r=await extractMailLensObservation({email,apiKey,model});
    const x=r.result.extraction;
    out[model]={
      eventIsOrderUpdated:x.event_type==='order_updated',
      phaseIsNull:x.shipment_phase===null,
      hasOrder:Boolean(x.order_number),
      hasTracking:Boolean(x.tracking_number),
      paymentStatusIsNull:x.payment_status===null,
      hasInvoice:Boolean(x.invoice_number),
      evidenceIssues:x.evidence_issues,
    };
  }
  console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error('CASE27_REVIEW_FATAL:',e instanceof Error?e.message:String(e));process.exit(1);});
