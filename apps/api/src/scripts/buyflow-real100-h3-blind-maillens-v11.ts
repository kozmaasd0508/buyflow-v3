import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';

type H = { name?: string; value?: string };
type B = { attachmentId?: string; size?: number; data?: string };
type P = { mimeType?: string; filename?: string; headers?: H[]; body?: B; parts?: P[] };
type M = { id?: string; threadId?: string; snippet?: string; payload?: P };
type L = { id?: string; threadId?: string };

const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me';
const COUNT=100;
const MAX_POOL=2000;
const QUERY='category:purchases';
const SEED='buyflow-real100-h3-v1';
const NORMALIZER='normalized-email-document-v1.1';
const H1_SHA='32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d';
const H2_SHA='0161411f2e6d5ecfac675ea78318495bc263b241c72b191f897371cc469a6164';
const MAILLENS_COMMIT='f69195404831323f2783464a61f6f7b7435698b5';
const PROMPT_V32_COMMIT='2eacf018ff6c7d2eef306a2449f1e76bb689f249';
const RETRY=[1000,2500,5000,10000,20000,40000];

const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function header(p:P|undefined,n:string){const q=n.toLowerCase();return (p?.headers??[]).find(h=>h.name?.toLowerCase()===q)?.value?.trim()??'';}
function reason(body:string){try{const j=JSON.parse(body);const r=j?.error?.errors?.[0]?.reason??j?.error?.status??j?.error?.message;if(typeof r==='string')return r.replace(/\s+/g,'_').slice(0,120);}catch{}return body.replace(/\s+/g,' ').trim().slice(0,120)||'unknown';}
function retry403(body:string){return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError|RESOURCE_EXHAUSTED/i.test(body);}
async function gj(pathname:string,token:string){for(let a=0;;a++){await sleep(120);const r=await fetch(GMAIL+pathname,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}});if(r.ok)return await r.json();const b=await r.text().catch(()=>'');if(([408,429,500,502,503,504].includes(r.status)||(r.status===403&&retry403(b)))&&a<RETRY.length){console.log(`  Gmail retry HTTP ${r.status} reason=${reason(b)} wait=${RETRY[a]}ms`);await sleep(RETRY[a]!);continue;}throw new Error(`GMAIL_HTTP_${r.status}:${reason(b)}`);}}
function detached(p:P){const m=p.mimeType?.toLowerCase();if(m!=='text/plain'&&m!=='text/html')return false;if(p.filename?.trim())return false;const d=header(p,'Content-Disposition').toLowerCase();if(/\battachment\b/.test(d))return false;return Boolean(p.body?.attachmentId?.trim()&&!p.body?.data);}
async function hydrate(p:P|undefined,id:string,token:string):Promise<number>{if(!p)return 0;let n=0;if(detached(p)){const aid=p.body!.attachmentId!.trim();const x=await gj(`/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(aid)}`,token);if(typeof x.data!=='string'||!x.data)throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');p.body={...p.body,data:x.data,...(typeof x.size==='number'?{size:x.size}:{})};n++;}for(const c of p.parts??[])n+=await hydrate(c,id,token);return n;}
async function list(token:string):Promise<L[]>{const out:L[]=[];let page:string|null=null;while(out.length<MAX_POOL){const q=new URLSearchParams({q:QUERY,maxResults:'500'});if(page)q.set('pageToken',page);const d=await gj(`/messages?${q}`,token);for(const x of d?.messages??[]){if(typeof x?.id==='string'&&x.id.trim())out.push({id:x.id,threadId:x.threadId});if(out.length>=MAX_POOL)break;}page=typeof d?.nextPageToken==='string'?d.nextPageToken:null;if(!page)break;}return out;}
function ids(doc:any,count:number,label:string){const a=Array.isArray(doc)?doc:doc?.ids;if(!Array.isArray(a)||a.length!==count||a.some((x:any)=>typeof x!=='string'||!x.trim()))throw new Error(`${label}_IDS_INVALID`);return a.map((x:string)=>x.trim());}
async function threads(messageIds:string[],token:string,label:string){const s=new Set<string>();for(let i=0;i<messageIds.length;i++){const m=await gj(`/messages/${encodeURIComponent(messageIds[i]!)}?format=metadata`,token) as M;if(m.threadId?.trim())s.add(m.threadId.trim());if((i+1)%20===0||i+1===messageIds.length)console.log(`  ${label} thread metadata: ${i+1}/${messageIds.length}`);}return s;}
async function readMaybe(p:string){try{return JSON.parse(await readFile(p,'utf8'));}catch(e:any){if(e?.code==='ENOENT')return null;throw e;}}

async function main(){
 const [real120Path,h1Path,h2Path,outArg]=process.argv.slice(2);if(!real120Path||!h1Path||!h2Path||!outArg)throw new Error('USAGE: <real120-ids> <h1-ids> <h2-ids> <out-dir>');
 const token=process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();if(!token)throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');
 const rdoc=JSON.parse(await readFile(real120Path,'utf8'));const h1doc=JSON.parse(await readFile(h1Path,'utf8'));const h2doc=JSON.parse(await readFile(h2Path,'utf8'));
 const rids=ids(rdoc,120,'REAL120');const h1ids=ids(h1doc,60,'H1');const h2ids=ids(h2doc,100,'H2');
 if(h1doc?.selection_sha256&&h1doc.selection_sha256!==H1_SHA)throw new Error('H1_SELECTION_SHA_INVALID');
 if(h2doc?.selection_sha256!==H2_SHA)throw new Error('H2_SELECTION_SHA_INVALID');
 if(!Array.isArray(h2doc?.thread_ids)||h2doc.thread_ids.length!==100)throw new Error('H2_THREAD_IDS_INVALID');
 const out=path.resolve(outArg);await mkdir(out,{recursive:true});
 const idPath=path.join(out,'real100-h3-ids-private-local.json');const partPath=path.join(out,'real100-h3-partial-private-local.json');const bundlePath=path.join(out,'real100-h3-blind-bundle-maillens-v1.1-private-local.json');const summaryPath=path.join(out,'real100-h3-summary.json');
 console.log('==============================================================');console.log('BUYFLOW REAL100 H3 - FRESH BLIND / MAILLENS v1.1');console.log('REAL120 + H1 + H2 IDs/threads excluded. One message per thread.');console.log('Selection content-blind and frozen before body fetch.');console.log('NO OpenAI calls | Gmail GET only | BuyFlow writes 0 | O3 NOT USED');console.log('==============================================================');
 let frozen=await readMaybe(idPath);let listedCount:number|null=null,eligibleCount:number|null=null,rThreads=new Set<string>(),h1Threads=new Set<string>();
 if(frozen){if(frozen.benchmark!=='buyflow-real100-h3-private-ids-v1'||!Array.isArray(frozen.ids)||frozen.ids.length!==COUNT||sha(frozen.ids.join('\n'))!==frozen.selection_sha256)throw new Error('H3_CHECKPOINT_INVALID');console.log(`[1/4] Reusing frozen H3 selection: ${frozen.selection_sha256}`);}else{
   console.log('[1/4] Excluding REAL120 + H1 + H2 threads...');rThreads=await threads(rids,token,'REAL120');h1Threads=await threads(h1ids,token,'H1');const h2Threads=new Set<string>(h2doc.thread_ids.filter((x:any)=>typeof x==='string'&&x.trim()).map((x:string)=>x.trim()));
   const exIds=new Set([...rids,...h1ids,...h2ids]);const exThreads=new Set([...rThreads,...h1Threads,...h2Threads]);
   console.log('[2/4] Building content-blind candidate pool...');const listed=await list(token);const eligible=listed.filter(x=>x.id&&!exIds.has(x.id)&&(!x.threadId||!exThreads.has(x.threadId)));eligible.sort((a,b)=>sha(`${SEED}\n${a.id}`).localeCompare(sha(`${SEED}\n${b.id}`)));
   const selected:{id:string;threadId:string|null}[]=[];const st=new Set<string>();for(const x of eligible){if(!x.id)continue;const k=x.threadId?.trim()||`id:${x.id}`;if(st.has(k))continue;st.add(k);selected.push({id:x.id,threadId:x.threadId?.trim()||null});if(selected.length===COUNT)break;}if(selected.length!==COUNT)throw new Error(`NOT_ENOUGH_FRESH_PURCHASE_THREADS:${selected.length}`);
   const selectedIds=selected.map(x=>x.id),selectionSha=sha(selectedIds.join('\n'));listedCount=listed.length;eligibleCount=eligible.length;frozen={benchmark:'buyflow-real100-h3-private-ids-v1',created_at:new Date().toISOString(),selection_sha256:selectionSha,count:COUNT,ids:selectedIds,thread_ids:selected.map(x=>x.threadId)};await writeFile(idPath,JSON.stringify(frozen,null,2)+'\n');console.log(`  listed=${listed.length} eligible=${eligible.length} selected=${selected.length}`);console.log(`  H3 selection frozen BEFORE body fetch: ${selectionSha}`);
 }
 const selectionSha=frozen.selection_sha256,selectedIds:string[]=frozen.ids;const partial=await readMaybe(partPath);let cases:any[]=[];if(partial){if(partial.selection_sha256!==selectionSha||!Array.isArray(partial.cases))throw new Error('H3_PARTIAL_INVALID');cases=partial.cases;console.log(`  Resuming body build from ${cases.length}/100.`);}
 console.log('[3/4] Creating MailLens v1.1 blind views...');for(let i=cases.length;i<COUNT;i++){const id=selectedIds[i]!;const caseId=`H3-${String(i+1).padStart(3,'0')}`;const msg=await gj(`/messages/${encodeURIComponent(id)}?format=full`,token) as M;if(msg.id!==id)throw new Error(`GMAIL_ID_MISMATCH:${caseId}`);const hydrated=await hydrate(msg.payload,id,token);const normalized=normalizeGmailMessage(msg as any);const doc=normalizeEmailDocumentV1(normalized);if(doc.normalizerVersion!==NORMALIZER)throw new Error(`STALE_MAILLENS_NORMALIZER:${doc.normalizerVersion}`);const semantic=(doc.semanticText?.trim()||doc.snippet?.trim()||''),snippet=(doc.snippet?.trim()||'');const source=doc.normalization.bodyTextSource;cases.push({case_id:caseId,from:header(msg.payload,'From'),subject:header(msg.payload,'Subject'),semantic_text:semantic,mail_lens_normalizer:doc.normalizerVersion,body_text_source:source,body_text_chars:doc.bodyText?.length??0,semantic_text_chars:semantic.length,snippet_chars:snippet.length,semantic_equals_snippet:Boolean(semantic&&snippet&&semantic===snippet),body_text_truncated:doc.normalization.bodyTextTruncated,semantic_text_truncated:doc.normalization.semanticTextTruncated,quoted_history_detected:doc.normalization.quotedHistoryDetected,hidden_html_removed:doc.normalization.hiddenHtmlRemoved,detached_bodies_hydrated:hydrated});await writeFile(partPath,JSON.stringify({benchmark:'buyflow-real100-h3-partial-v1',selection_sha256:selectionSha,completed:cases.length,cases},null,2)+'\n');console.log(`[${String(i+1).padStart(3,'0')}/100] ${caseId} source=${source} chars=${semantic.length}`);}
 if(cases.length!==COUNT)throw new Error(`H3_CASE_COUNT_INVALID:${cases.length}`);
 const sourceCounts:Record<string,number>={};let hydrated=0,eq=0,semTr=0,bodyTr=0;for(const c of cases){sourceCounts[c.body_text_source]=(sourceCounts[c.body_text_source]??0)+1;hydrated+=c.detached_bodies_hydrated;if(c.semantic_equals_snippet)eq++;if(c.semantic_text_truncated)semTr++;if(c.body_text_truncated)bodyTr++;}
 const bundle={benchmark:'buyflow-real100-h3-blind-maillens-v1.1',created_at:new Date().toISOString(),selection_sha256:selectionSha,mail_lens_normalizer:NORMALIZER,mail_lens_pinned_commit:MAILLENS_COMMIT,prompt_v32_frozen_commit:PROMPT_V32_COMMIT,total:COUNT,gold_labels_included:false,cases};await writeFile(bundlePath,JSON.stringify(bundle,null,2)+'\n');
 const summary={benchmark:'buyflow-real100-h3-selection-summary-v1',created_at:new Date().toISOString(),query:QUERY,pool_limit:MAX_POOL,listed_count:listedCount,eligible_after_real120_h1_h2_exclusion:eligibleCount,selected_count:COUNT,real120_ids_excluded:120,h1_ids_excluded:60,h2_ids_excluded:100,one_message_per_thread:true,content_blind_selection:true,selection_frozen_before_body_fetch:true,resumable_checkpoint:true,selection_sha256:selectionSha,mail_lens_normalizer:NORMALIZER,mail_lens_pinned_commit:MAILLENS_COMMIT,prompt_v32_frozen_commit:PROMPT_V32_COMMIT,input_audit:{source_counts:sourceCounts,hydrated_detached_bodies:hydrated,semantic_equals_gmail_snippet_count:eq,semantic_text_truncated_count:semTr,body_text_truncated_count:bodyTr},openai_calls:0,gmail_http_methods:['GET'],buyflow_writes:0,production_off:true,blind_o3_used:false};await writeFile(summaryPath,JSON.stringify(summary,null,2)+'\n');
 console.log('[4/4] H3 FROZEN. Luna has NOT run.');console.log(`  selection_sha256=${selectionSha}`);console.log(`  bundle=${bundlePath}`);console.log(`  summary=${summaryPath}`);console.log(`  private_ids=${idPath}`);
}
main().catch(e=>{console.error(`REAL100_H3_FATAL: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
