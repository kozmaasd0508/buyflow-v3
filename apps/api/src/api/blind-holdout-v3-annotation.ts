import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
  BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
  blindHoldoutV3CaseId,
  freezeBlindHoldoutV3Truth,
} from '../extraction-v2/blind-holdout-v3-annotation.js';
import { BLIND_HOLDOUT_V3_FIELDS } from '../extraction-v2/blind-holdout-v3.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const MAX_SCAN = 2_000;
const BODY_MAX_CHARS = 80_000;

async function resolveUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function candidateLimit(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 20;
  return Math.max(1, Math.min(100, Number(value)));
}

function bodyText(message: NormalizedEmail): { text: string; source: 'html_compacted' | 'snippet' } {
  if (message.bodyHtml) {
    return {
      text: htmlToCompactText(message.bodyHtml, BODY_MAX_CHARS),
      source: 'html_compacted',
    };
  }
  return {
    text: (message.snippet ?? '').slice(0, BODY_MAX_CHARS),
    source: 'snippet',
  };
}

function candidateForUser(userId: string, message: NormalizedEmail) {
  const body = bodyText(message);
  return {
    caseId: blindHoldoutV3CaseId(userId, message.providerMessageId),
    receivedAt: message.receivedAt,
    sender: {
      name: message.from[0]?.name ?? null,
      address: message.from[0]?.email ?? null,
    },
    subject: message.subject ?? '',
    bodyText: body.text,
    bodySource: body.source,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size ?? null,
    })),
  };
}

function pageReachedCutoffBoundary(messages: NormalizedEmail[], cutoffMs: number): boolean {
  const timestamps = messages
    .map((message) => Date.parse(message.receivedAt))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return false;

  const newestFirst = timestamps.every((value, index) => (
    index === 0 || timestamps[index - 1]! >= value
  ));
  return newestFirst && timestamps.some((value) => value <= cutoffMs);
}

async function loadCandidates(userId: string, limit: number) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db
    .from('email_connections')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });

  const cutoffMs = Date.parse(BLIND_HOLDOUT_V3_SELECTION_CUTOFF);
  const matches: NormalizedEmail[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let reachedCutoffBoundary = false;

  do {
    const page = await provider.searchMessages({
      query: '-in:spam -in:trash',
      limit: Math.min(100, MAX_SCAN - scanned),
      ...(cursor ? { cursor } : {}),
    });
    if (page.messages.length === 0) break;

    for (const message of page.messages) {
      const receivedMs = Date.parse(message.receivedAt);
      if (Number.isFinite(receivedMs) && receivedMs > cutoffMs) matches.push(message);
    }

    scanned += page.messages.length;
    reachedCutoffBoundary = pageReachedCutoffBoundary(page.messages, cutoffMs);
    cursor = reachedCutoffBoundary ? undefined : page.nextCursor;
  } while (cursor && scanned < MAX_SCAN);

  if (!reachedCutoffBoundary && cursor && scanned >= MAX_SCAN) {
    throw new Error('blind_v3_candidate_scan_truncated');
  }

  const candidates = matches
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .slice(0, limit)
    .map((message) => candidateForUser(userId, message));

  return {
    candidates,
    availablePostFreeze: matches.length,
    scanned,
    reachedCutoffBoundary,
  };
}

function pageHtml() {
  const fields = JSON.stringify(BLIND_HOLDOUT_V3_FIELDS);
  const cutoff = JSON.stringify(BLIND_HOLDOUT_V3_SELECTION_CUTOFF);
  const freezeCommit = JSON.stringify(BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT);
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind Holdout v3 Ground Truth</title>
<style>
body{font-family:system-ui;background:#071020;color:#fff;max-width:1280px;margin:auto;padding:24px}.c{background:#0d1830;padding:18px;border-radius:16px;margin:14px 0}.muted{color:#9fb0c9}.bad{color:#ff9b9b}.good{color:#8ef0ba}button,select,input,textarea{font:inherit;border-radius:8px;border:1px solid #344665;padding:8px;background:#111e37;color:#fff}button{background:#7c4dff;border:0;font-weight:700;cursor:pointer}button.secondary{background:#263551}button:disabled{opacity:.45;cursor:not-allowed}.candidate{border:1px solid #263551;border-radius:12px;padding:14px;margin:16px 0}.meta{font-size:13px;color:#aebbd0}.mail{white-space:pre-wrap;max-height:280px;overflow:auto;background:#071020;padding:12px;border-radius:8px;margin:8px 0}.field{display:grid;grid-template-columns:170px 180px 1fr;gap:8px;align-items:start;margin:7px 0}.field label{padding-top:9px}.known{width:100%;box-sizing:border-box}textarea.known{min-height:70px}code{word-break:break-all}.sticky{position:sticky;top:0;z-index:5}#frozen{width:100%;min-height:220px}.warn{border-left:4px solid #ffcf66}.progress{font-weight:700}
</style>
<div class="c sticky"><b>BLIND HOLDOUT v3 · GROUND TRUTH ANNOTATION · ENGINE HIDDEN · 0 WRITE · 0 AI</b><h1>Field Ground Truth v3</h1><p class="muted">Csak a freeze után érkezett eredeti leveleket látod. Ezen az oldalon nincs v2/legacy prediction, evidence vagy parser output.</p><p>Candidate freeze: <code>${BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT}</code><br>Selection cutoff: <code>${BLIND_HOLDOUT_V3_SELECTION_CUTOFF}</code></p><select id="limit"><option>10</option><option selected>20</option><option>50</option><option>100</option></select> <button id="load" type="button">Post-freeze levelek betöltése</button> <span id="status"></span><p class="progress" id="progress"></p></div>
<div class="c warn"><b>Vakteszt szabály</b><p>A levelet előbb kézzel annotáld. A motor eredményét csak a GT JSON + SHA-256 lezárása és repository-freeze után szabad futtatni. A raw levélszöveg nem kerül a GT JSON-ba.</p></div>
<div id="list"></div>
<div class="c"><button id="freeze" type="button" disabled>GT csomag lezárása</button> <span id="freezeStatus"></span><p id="hash"></p><textarea id="frozen" readonly placeholder="A canonical GT JSON itt jelenik meg."></textarea></div>
<script>
(() => {
  const FIELDS = ${fields};
  const CUTOFF = ${cutoff};
  const FREEZE_COMMIT = ${freezeCommit};
  const EVENT_TYPES = ['order_created','shipment','delivery','invoice_or_receipt','payment_completed','refund','return','cancellation'];
  const PAYMENT_STATUSES = ['paid','cash_on_delivery','failed','refunded'];
  const el = (id) => document.getElementById(id);
  const loadButton=el('load'), list=el('list'), status=el('status'), freezeButton=el('freeze'), freezeStatus=el('freezeStatus'), progress=el('progress'), frozen=el('frozen'), hash=el('hash'), limit=el('limit');
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let candidates=[];
  const storageKey='buyflow_blind_v3_annotations_' + FREEZE_COMMIT.slice(0,12);
  let annotations={};
  try{annotations=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch{annotations={}}

  let clientPromise=null;
  const getClient=async()=>{if(!clientPromise){clientPromise=import('https://esm.sh/@supabase/supabase-js@2').then(({createClient})=>createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp'));}return clientPromise;};
  const auth=async()=>{const c=await getClient();const {data,error}=await c.auth.getSession();if(error)throw error;if(!data.session)throw new Error('Jelentkezz be a BuyFlow-ba.');return data.session.access_token;};
  const valueControl=(field)=>field==='eventType'?'<select class="known" data-value><option value=""></option>'+EVENT_TYPES.map(x=>'<option>'+x+'</option>').join('')+'</select>':field==='paymentStatus'?'<select class="known" data-value><option value=""></option>'+PAYMENT_STATUSES.map(x=>'<option>'+x+'</option>').join('')+'</select>':field==='products'?'<textarea class="known" data-value placeholder=\'[ {"name":"...","quantity":1,"unitPrice":null,"totalPrice":null,"currency":"HUF"} ]\'></textarea>':field==='total'?'<input class="known" data-value type="number" step="0.01">':'<input class="known" data-value type="text">';
  const fieldHtml=(field)=>'<div class="field" data-field="'+field+'"><label>'+field+'</label><select data-state><option value="">— válassz —</option><option value="known">known</option><option value="not_applicable">not_applicable</option><option value="unknown">unknown</option></select><div>'+valueControl(field)+'</div></div>';
  const save=()=>{localStorage.setItem(storageKey,JSON.stringify(annotations));};
  const readCard=(card)=>{const caseId=card.dataset.caseId;const commerce=card.querySelector('[data-commerce]').value;const item={isCommerceEvent:commerce==='yes',commerceSelected:Boolean(commerce),fields:{}};card.querySelectorAll('[data-field]').forEach(row=>{const field=row.dataset.field,state=row.querySelector('[data-state]').value,value=row.querySelector('[data-value]').value;item.fields[field]={state,value};});annotations[caseId]=item;save();return item;};
  const applyStored=(card)=>{const item=annotations[card.dataset.caseId];if(!item)return;card.querySelector('[data-commerce]').value=item.commerceSelected?(item.isCommerceEvent?'yes':'no'):'';for(const field of FIELDS){const row=card.querySelector('[data-field="'+field+'"]'),saved=item.fields?.[field];if(!saved)continue;row.querySelector('[data-state]').value=saved.state||'';row.querySelector('[data-value]').value=saved.value??'';toggleValue(row);}};
  const toggleValue=(row)=>{const enabled=row.querySelector('[data-state]').value==='known';row.querySelector('[data-value]').disabled=!enabled;};
  const complete=(item)=>item&&item.commerceSelected&&FIELDS.every(field=>{const e=item.fields?.[field];if(!e?.state)return false;if(e.state!=='known')return true;if(field==='products'){try{return Array.isArray(JSON.parse(e.value))}catch{return false}}if(field==='total')return e.value!==''&&Number.isFinite(Number(e.value));return String(e.value||'').trim().length>0;});
  const updateProgress=()=>{const cards=[...document.querySelectorAll('.candidate')];const done=cards.filter(card=>complete(readCard(card))).length;progress.textContent=cards.length?('Kész: '+done+' / '+cards.length):'';freezeButton.disabled=!cards.length||done!==cards.length;};
  const markNoise=(card)=>{card.querySelector('[data-commerce]').value='no';card.querySelectorAll('[data-field]').forEach(row=>{row.querySelector('[data-state]').value='not_applicable';row.querySelector('[data-value]').value='';toggleValue(row);});updateProgress();};
  const markCommerce=(card)=>{card.querySelector('[data-commerce]').value='yes';updateProgress();};

  list.addEventListener('change',(event)=>{const row=event.target.closest?.('[data-field]');if(row)toggleValue(row);updateProgress();});
  list.addEventListener('input',()=>updateProgress());
  list.addEventListener('click',(event)=>{const card=event.target.closest?.('.candidate');if(!card)return;if(event.target.matches('[data-noise]'))markNoise(card);if(event.target.matches('[data-commerce-action]'))markCommerce(card);});

  loadButton.addEventListener('click',async()=>{loadButton.disabled=true;status.className='';status.textContent=' Betöltés…';list.innerHTML='';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);try{const token=await auth();const r=await fetch('/api/audit/blind-v3/candidates?limit='+encodeURIComponent(limit.value),{method:'POST',headers:{Authorization:'Bearer '+token},signal:controller.signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'candidate_load_failed');candidates=d.candidates||[];status.textContent=' '+candidates.length+' jelölt · összes post-freeze: '+d.availablePostFreeze+' · scanned: '+d.scanned;if(!candidates.length){list.innerHTML='<div class="c"><h2>Még nincs post-freeze levél.</h2><p class="muted">Cutoff: '+esc(CUTOFF)+'. A vakteszt integritása miatt régi leveleket nem emelünk be helyettük.</p></div>';return;}list.innerHTML=candidates.map((m,i)=>'<div class="c candidate" data-case-id="'+esc(m.caseId)+'"><h2>C'+(i+1)+' · <code>'+esc(m.caseId.slice(0,16))+'…</code></h2><div class="meta">'+esc(m.receivedAt)+' · '+esc(m.sender.name||'')+' &lt;'+esc(m.sender.address||'')+'&gt; · body: '+esc(m.bodySource)+'</div><h3>'+esc(m.subject)+'</h3><pre class="mail">'+esc(m.bodyText)+'</pre>'+(m.attachments?.length?'<p class="meta">Attachments: '+m.attachments.map(a=>esc(a.filename)+' ('+esc(a.contentType)+')').join(', ')+'</p>':'')+'<p><select data-commerce><option value="">— commerce? —</option><option value="yes">YES · commerce event</option><option value="no">NO · noise/non-commerce</option></select> <button type="button" data-commerce-action>Commerce</button> <button type="button" class="secondary" data-noise>Nem commerce</button></p>'+FIELDS.map(fieldHtml).join('')+'</div>').join('');document.querySelectorAll('.candidate').forEach(card=>{card.querySelectorAll('[data-field]').forEach(toggleValue);applyStored(card);});updateProgress();}catch(error){status.textContent=error?.name==='AbortError'?' Hiba: a levélbetöltés 30 másodperc után megszakadt.':' Hiba: '+(error?.message||String(error));status.className='bad';}finally{clearTimeout(timer);loadButton.disabled=false;}});

  const truthFromCards=()=>[...document.querySelectorAll('.candidate')].map(card=>{const item=readCard(card);const fields={};for(const field of FIELDS){const e=item.fields[field];if(e.state==='known'){let value=e.value;if(field==='total')value=Number(value);else if(field==='products')value=JSON.parse(value);fields[field]={state:'known',value};}else fields[field]={state:e.state};}return{caseId:card.dataset.caseId,isCommerceEvent:item.isCommerceEvent,fields};});

  freezeButton.addEventListener('click',async()=>{freezeButton.disabled=true;freezeStatus.textContent=' Lezárás…';try{const token=await auth();const truth=truthFromCards();const r=await fetch('/api/audit/blind-v3/freeze',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({truth})});const d=await r.json();if(!r.ok)throw new Error(d.error||'freeze_failed');frozen.value=d.canonicalJson;hash.innerHTML='<b>SHA-256:</b> <code>'+esc(d.truthSha256)+'</code><br><b>Cases:</b> '+d.cases+' · engineRun: NO · 0 write · 0 AI';freezeStatus.textContent=' LEZÁRVA. A motor még nem futott.';freezeStatus.className='good';}catch(error){freezeStatus.textContent=' Hiba: '+(error?.message||String(error));freezeStatus.className='bad';freezeButton.disabled=false;}});
})();
</script>`;
}

export async function registerBlindHoldoutV3Annotation(app: FastifyInstance) {
  app.get('/audit-blind-v3-annotate', async (_request, reply) => reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .send(pageHtml()));

  app.post<{ Querystring: { limit?: string } }>('/api/audit/blind-v3/candidates', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      const result = await loadCandidates(user.id, candidateLimit(request.query.limit));
      return reply.send({
        ok: true,
        mode: 'ground_truth_annotation',
        engineRun: false,
        productionWrites: 0,
        aiCalls: 0,
        candidateFreezeCommit: BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
        selectionCutoff: BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
        ...result,
      });
    } catch (error) {
      request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Blind v3 candidate read failed');
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'blind_v3_candidate_read_failed' });
    }
  });

  app.post<{ Body: { truth?: unknown } }>('/api/audit/blind-v3/freeze', async (request, reply) => {
    const user = await resolveUser(request, reply);
    if (!user) return;
    try {
      const frozen = freezeBlindHoldoutV3Truth(request.body?.truth);
      return reply.send({
        ok: true,
        mode: 'ground_truth_freeze',
        engineRun: false,
        productionWrites: 0,
        aiCalls: 0,
        cases: frozen.bundle.truth.length,
        truthSha256: frozen.truthSha256,
        canonicalJson: frozen.canonicalJson,
        bundle: frozen.bundle,
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'blind_v3_freeze_failed' });
    }
  });
}
