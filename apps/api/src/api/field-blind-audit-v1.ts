import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { FIELD_BLIND_GROUND_TRUTH_V1, FIELD_BLIND_META_V1, type BlindExpectation } from './field-blind-ground-truth-v1.js';

const COMMERCE_LABEL='BuyFlow Field Blind/v1 Commerce';
const NOISE_LABEL='BuyFlow Field Blind/v1 Noise';
const FIELDS=['eventType','merchant','orderNumber','total','currency','carrier','trackingNumber','paymentStatus','products'] as const;
type FieldName=typeof FIELDS[number];

function norm(v: unknown){return typeof v==='string'?v.normalize('NFKC').trim().toLowerCase():v;}
function same(a:unknown,b:unknown){return JSON.stringify(norm(a))===JSON.stringify(norm(b));}
function text(email:NormalizedEmail){return `${email.subject??''}\n${email.snippet??''}\n${email.bodyHtml??''}`;}
function actualFields(plan:ReturnType<typeof planNormalizedInboundEmail>){const r=plan.validatedResult??plan.structuredResult;return {eventType:r.event_type??plan.classification??null,merchant:r.merchant??r.merchant_legal_name??null,orderNumber:r.order_number??null,total:r.total??null,currency:r.currency??null,carrier:r.carrier??null,trackingNumber:r.tracking_number??null,paymentStatus:r.payment_status??null,products:Array.isArray(r.products)?r.products:[]} as Record<FieldName,unknown>;}
function evaluate(expected:BlindExpectation<unknown>,actual:unknown){if(expected.state==='not_asserted')return{asserted:false,pass:true,expected:'not_asserted',actual};if(expected.state==='null')return{asserted:true,pass:actual==null||(Array.isArray(actual)&&actual.length===0),expected:null,actual};return{asserted:true,pass:same(expected.value,actual),expected:expected.value,actual};}

async function requireUser(request:FastifyRequest,reply:FastifyReply){const user=await resolveAuthenticatedApiUser(request.headers.authorization);if(!user){await reply.code(401).send({error:'unauthorized'});return null;}return user;}
async function loadLabel(provider:ReturnType<typeof createEmailProvider>,label:string){const out:NormalizedEmail[]=[];let cursor:string|undefined;let scanned=0;do{const page=await provider.searchMessages({query:`label:\"${label}\" -in:spam -in:trash`,limit:100,...(cursor?{cursor}:{})});out.push(...page.messages);scanned+=page.messages.length;cursor=page.nextCursor;}while(cursor&&scanned<2000);return out;}

async function run(userId:string){
  const db=getSupabaseAdmin() as any;
  const {data:connection,error}=await db.from('email_connections').select('provider_account_id').eq('user_id',userId).eq('provider','nylas').eq('status','active').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw new Error('email_connection_lookup_failed');
  if(!connection?.provider_account_id)throw new Error('active_nylas_connection_not_found');
  const provider=createEmailProvider({provider:'nylas',providerAccountId:connection.provider_account_id});
  const [commerce,noise]=await Promise.all([loadLabel(provider,COMMERCE_LABEL),loadLabel(provider,NOISE_LABEL)]);

  const commerceRows=FIELD_BLIND_GROUND_TRUTH_V1.map(truth=>{
    const email=commerce.find(m=>norm(m.from[0]?.email??'')===norm(truth.selector.sender)&&norm(m.subject??'')===norm(truth.selector.subject)&&(!truth.selector.contains||norm(text(m)).includes(norm(truth.selector.contains) as string)));
    if(!email)return{id:truth.id,found:false,recognized:false,criticalMismatch:true,fields:[]};
    const plan=planNormalizedInboundEmail({email});const actual=actualFields(plan);
    const fields=FIELDS.map(name=>({name,...evaluate(truth[name] as BlindExpectation<unknown>,actual[name])}));
    const recognized=Boolean(plan.classification);
    const criticalMismatch=!recognized||fields.some(f=>f.asserted&&!f.pass&&['eventType','orderNumber','total','currency','carrier','trackingNumber','paymentStatus'].includes(f.name));
    return{id:truth.id,found:true,recognized,subject:email.subject??null,sender:email.from[0]?.email??null,classification:plan.classification,parserVersion:plan.parserVersion,criticalMismatch,fields};
  });

  const noiseRows=noise.map(email=>{const plan=planNormalizedInboundEmail({email});return{subject:email.subject??null,sender:email.from[0]?.email??null,recognized:Boolean(plan.classification),classification:plan.classification,parserVersion:plan.parserVersion};});
  const tp=commerceRows.filter(r=>r.found&&r.recognized).length,fn=commerceRows.length-tp,fp=noiseRows.filter(r=>r.recognized).length,tn=noiseRows.length-fp;
  const precision=tp+fp?tp/(tp+fp):null,recall=tp+fn?tp/(tp+fn):null;
  const fieldSummary=Object.fromEntries(FIELDS.map(name=>{const xs=commerceRows.flatMap((r:any)=>r.fields??[]).filter((f:any)=>f.name===name&&f.asserted);const passed=xs.filter((f:any)=>f.pass).length;return[name,{asserted:xs.length,passed,failed:xs.length-passed,accuracy:xs.length?passed/xs.length:null}];}));
  const asserted=Object.values(fieldSummary).reduce((n:any,s:any)=>n+s.asserted,0) as number;const passed=Object.values(fieldSummary).reduce((n:any,s:any)=>n+s.passed,0) as number;
  return{ok:true,mode:'blind-shadow',productionWrites:0,aiCalls:0,meta:FIELD_BLIND_META_V1,commerceExpected:commerceRows.length,commerceFound:commerceRows.filter(r=>r.found).length,noiseCount:noiseRows.length,tp,fn,fp,tn,precision,recall,assertedFields:asserted,passedFields:passed,overallFieldAccuracy:asserted?passed/asserted:null,criticalMismatchCount:commerceRows.filter(r=>r.criticalMismatch).length,fieldSummary,commerceRows,noiseRows};
}

function page(){return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Field Blind Holdout v1</title><style>body{font-family:system-ui;background:#071020;color:#fff;margin:0}main{max-width:1100px;margin:auto;padding:28px}.card{background:#0d1830;padding:20px;border-radius:18px;margin:14px 0}.row{border-top:1px solid #ffffff18;padding:10px 0}.ok{color:#63e6aa}.bad{color:#ff7d9d}.muted{color:#9eacd0}button{padding:12px 16px;border:0;border-radius:12px;background:#7c4dff;color:#fff;font-weight:700}</style></head><body><main><div class="card"><b>BLIND FIELD HOLDOUT · FROZEN BEFORE RUN · 0 WRITE · 0 AI</b><h1>Field Blind Holdout v1</h1><p>Új, korábban nem használt valódi levelek. Az első eredményt rögzíteni kell, mielőtt parserhez nyúlunk.</p><button id="run">Első vakteszt futtatása</button> <span id="s" class="muted"></span></div><div id="o" class="card" hidden></div></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const c=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp'),b=document.querySelector('#run'),o=document.querySelector('#o'),s=document.querySelector('#s'),p=v=>v==null?'—':(v*100).toFixed(1)+'%';b.onclick=async()=>{const{data}=await c.auth.getSession();if(!data.session){s.textContent='Jelentkezz be.';return}b.disabled=true;s.textContent='Fut…';try{const r=await fetch('/api/audit/field-blind-v1',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token}}),d=await r.json();if(!r.ok)throw new Error(d.error||'hiba');o.hidden=false;o.innerHTML='<h2>Detection: '+p(d.precision)+' precision · '+p(d.recall)+' recall</h2><p>TP '+d.tp+' · FN '+d.fn+' · FP '+d.fp+' · TN '+d.tn+'</p><h2>Fields: '+p(d.overallFieldAccuracy)+'</h2><p>Found '+d.commerceFound+'/'+d.commerceExpected+' · asserted '+d.assertedFields+' · critical mismatch <b class="'+(d.criticalMismatchCount?'bad':'ok')+'">'+d.criticalMismatchCount+'</b></p>'+Object.entries(d.fieldSummary).map(([k,v])=>'<div class="row"><b>'+k+'</b> · '+p(v.accuracy)+' · '+v.passed+'/'+v.asserted+'</div>').join('');s.textContent='Kész. 0 write · 0 AI.'}catch(e){s.textContent='Hiba: '+e.message}finally{b.disabled=false}};</script></body></html>`;}

export async function registerFieldBlindAuditV1(app:FastifyInstance){app.get('/audit-fields-blind-v1',async(_q,r)=>r.code(200).type('text/html; charset=utf-8').header('Cache-Control','no-store').send(page()));app.post('/api/audit/field-blind-v1',async(q,r)=>{const user=await requireUser(q,r);if(!user)return;try{return r.code(200).send(await run(user.id));}catch(error){const code=error instanceof Error?error.message:'field_blind_audit_failed';return r.code(code==='active_nylas_connection_not_found'?404:503).send({ok:false,error:code});}});}
