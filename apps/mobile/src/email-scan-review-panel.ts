import { BUYFLOW_AUDIT_WINDOWS, DEFAULT_BUYFLOW_AUDIT_WINDOW, type BuyFlowAuditWindow } from './audit-window-options.js';
import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './email-scan-review-panel.css';

interface Connection { id:string; provider:string; status:string }
type ScanState = 'in_buyflow'|'can_add'|'related_unlinked'|'uncertain_order'|'not_purchase'|'ai_error';
interface ScanItem {
  sourceEmailId:string;
  jobId:string;
  subject:string;
  senderDomain:string|null;
  receivedAt:string;
  gmailCategoryPurchases:boolean;
  filterRelevant:boolean;
  filterReasons:string[];
  aiEventType:string|null;
  aiConfidence:number|null;
  aiValidationStatus:string|null;
  aiErrorCode:string|null;
  merchant:string|null;
  orderNumber:string|null;
  total:number|null;
  currency:string|null;
  productCount:number;
  state:ScanState;
  canAdd:boolean;
  linkedPurchase:null|{id:string;merchantName:string|null;orderNumber:string|null;currentState:string};
}
interface AuditResponse {
  windowDays:number;
  query:string;
  audit:null|{
    id:string;
    status:string;
    processedAt:string|null;
    errorCode:string|null;
    result:Record<string,number>|null;
    resultsReady:number;
  };
  summary:{
    total:number;
    gmailPurchases:number;
    filterRelevant:number;
    aiCommerce:number;
    inBuyFlow:number;
    canAdd:number;
    relatedUnlinked:number;
    uncertain:number;
    notPurchase:number;
    aiErrors:number;
  };
  items:ScanItem[];
}

let selectedWindow: BuyFlowAuditWindow = DEFAULT_BUYFLOW_AUDIT_WINDOW;

function escapeHtml(value:unknown):string{return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function formatDate(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)}
function formatMoney(amount:number|null,currency:string|null){if(amount===null)return null;try{return new Intl.NumberFormat('hu-HU',{style:'currency',currency:currency||'HUF',maximumFractionDigits:currency==='HUF'?0:2}).format(amount)}catch{return `${amount} ${currency||''}`.trim()}}
function percent(value:number|null){return value===null?'—':`${Math.round(value*100)}%`}

async function token(){const {data}=await supabase.auth.getSession();if(!data.session)throw new Error('SESSION_REQUIRED');return data.session.access_token}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{const access=await token();const res=await fetch(`${mobileConfig.apiBaseUrl}${path}`,{...init,headers:{Authorization:`Bearer ${access}`,Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers??{})}});if(!res.ok)throw new Error(`API_${res.status}`);return await res.json() as T}
async function activeConnection():Promise<Connection|null>{const data=await request<{connections:Connection[]}>('/api/email-connections');return data.connections.find(c=>c.provider==='nylas'&&c.status==='active')??null}

function close(){document.querySelector('#buyflow-scan-review-overlay')?.remove()}
function eventLabel(value:string|null){const labels:Record<string,string>={order_created:'Rendelés',order_updated:'Rendelés frissítés',payment_completed:'Fizetés',shipment:'Feladás / szállítás',delivery:'Kézbesítés',invoice_or_receipt:'Számla / nyugta',refund:'Visszatérítés',return:'Visszaküldés',subscription:'Előfizetés',other:'Nem vásárlási email'};return value?labels[value]||value:'AI hiba / még nincs eredmény'}
function stateLabel(item:ScanItem){if(item.state==='in_buyflow')return ['BuyFlowban','good'];if(item.state==='can_add')return ['Hozzáadható','warn'];if(item.state==='related_unlinked')return ['Kapcsolódó, nincs összekötve','warn'];if(item.state==='uncertain_order')return ['Bizonytalan rendelés','warn'];if(item.state==='ai_error')return ['AI hiba','bad'];return ['Nem vásárlás','muted']}
function yesNoChip(label:string,value:boolean){return `<span class="scan-stage ${value?'pass':'miss'}"><small>${escapeHtml(label)}</small><strong>${value?'IGEN':'NEM'}</strong></span>`}

function cardHtml(item:ScanItem){
  const [state,cls]=stateLabel(item);
  const money=formatMoney(item.total,item.currency);
  const aiCommerce=Boolean(item.aiEventType&&item.aiEventType!=='other');
  const missedByGmail=aiCommerce&&!item.gmailCategoryPurchases;
  const missedByFilter=aiCommerce&&!item.filterRelevant;
  return `<article class="scan-email-card" data-source-id="${escapeHtml(item.sourceEmailId)}" data-job-id="${escapeHtml(item.jobId)}">
    <div class="scan-email-top"><strong>${escapeHtml(item.subject)}</strong><span class="scan-email-date">${escapeHtml(formatDate(item.receivedAt))}</span></div>
    <div class="scan-pipeline-grid">
      ${yesNoChip('Gmail Purchases',item.gmailCategoryPurchases)}
      ${yesNoChip('BuyFlow szűrő',item.filterRelevant)}
      <span class="scan-stage ${item.aiErrorCode?'error':aiCommerce?'pass':'neutral'}"><small>AI</small><strong>${escapeHtml(item.aiErrorCode?'HIBA':eventLabel(item.aiEventType))}</strong></span>
      <span class="scan-stage ${cls}"><small>BuyFlow</small><strong>${escapeHtml(state)}</strong></span>
    </div>
    ${missedByGmail?'<div class="scan-discovery-hit">AI vásárlási levelet talált, amely nem volt a Gmail <code>category:purchases</code> kategóriában.</div>':''}
    ${missedByFilter?'<div class="scan-discovery-hit important">AI vásárlási levelet talált, amelyet a jelenlegi BuyFlow előszűrő kihagyna.</div>':''}
    <div class="scan-email-meta"><span class="scan-chip ${cls}">${escapeHtml(state)}</span><span class="scan-chip">${escapeHtml(eventLabel(item.aiEventType))}</span>${item.aiValidationStatus?`<span class="scan-chip">${escapeHtml(item.aiValidationStatus)}</span>`:''}${item.aiConfidence!==null?`<span class="scan-chip">AI ${escapeHtml(percent(item.aiConfidence))}</span>`:''}</div>
    <div class="scan-email-details">
      ${item.merchant?`<div><strong>Webshop:</strong> ${escapeHtml(item.merchant)}</div>`:''}
      ${item.orderNumber?`<div><strong>Rendelés:</strong> ${escapeHtml(item.orderNumber)}</div>`:''}
      ${money?`<div><strong>Összeg:</strong> ${escapeHtml(money)}</div>`:''}
      ${item.productCount?`<div><strong>Termék:</strong> ${item.productCount} db</div>`:''}
      ${item.senderDomain?`<div><strong>Feladó domain:</strong> ${escapeHtml(item.senderDomain)}</div>`:''}
      ${item.filterReasons.length?`<div><strong>Előszűrő jelei:</strong> ${escapeHtml(item.filterReasons.join(', '))}</div>`:''}
      ${item.linkedPurchase?`<div><strong>Kapcsolva:</strong> ${escapeHtml(item.linkedPurchase.merchantName||'Vásárlás')} ${item.linkedPurchase.orderNumber?`#${escapeHtml(item.linkedPurchase.orderNumber)}`:''}</div>`:''}
      ${item.aiErrorCode?`<div><strong>AI hiba:</strong> ${escapeHtml(item.aiErrorCode)}</div>`:''}
    </div>
    ${item.canAdd?'<button class="scan-add-button" type="button">Hozzáadás a BuyFlowhoz</button>':''}
  </article>`;
}

function summaryHtml(data:AuditResponse){return `<div class="scan-review-summary wide">
  <div class="scan-review-stat"><strong>${data.summary.total}</strong><span>AI által átnézett</span></div>
  <div class="scan-review-stat"><strong>${data.summary.gmailPurchases}</strong><span>Gmail Purchases</span></div>
  <div class="scan-review-stat"><strong>${data.summary.filterRelevant}</strong><span>előszűrő találat</span></div>
  <div class="scan-review-stat"><strong>${data.summary.aiCommerce}</strong><span>AI vásárlási</span></div>
  <div class="scan-review-stat"><strong>${data.summary.inBuyFlow}</strong><span>BuyFlowban</span></div>
  <div class="scan-review-stat"><strong>${data.summary.canAdd}</strong><span>hozzáadható</span></div>
  <div class="scan-review-stat"><strong>${data.summary.relatedUnlinked}</strong><span>kapcsolatlan</span></div>
  <div class="scan-review-stat"><strong>${data.summary.aiErrors}</strong><span>AI hiba</span></div>
</div>`}

async function addPurchase(connectionId:string,item:ScanItem,button:HTMLButtonElement){
  button.disabled=true;button.textContent='Hozzáadás…';
  try{
    await request(`/api/email-connections/${encodeURIComponent(connectionId)}/audit/${encodeURIComponent(item.jobId)}/${encodeURIComponent(item.sourceEmailId)}/add-purchase`,{method:'POST'});
    button.textContent='Hozzáadva ✓';
    await render(connectionId,selectedWindow);
    window.setTimeout(()=>window.location.reload(),700);
  }catch{button.disabled=false;button.textContent='Nem sikerült – próbáld újra'}
}

async function render(connectionId:string,windowDays:BuyFlowAuditWindow){
  const body=document.querySelector<HTMLElement>('#scan-review-body');if(!body)return;
  try{
    const data=await request<AuditResponse>(`/api/email-connections/${encodeURIComponent(connectionId)}/audit?windowDays=${windowDays}`);
    const audit=data.audit;
    const working=Boolean(audit&&['pending','processing','retry'].includes(audit.status));
    const progress=audit?.result?.checked??audit?.resultsReady??0;
    body.innerHTML=`
      <div class="scan-review-note"><strong>Teljes ${windowDays} napos AI benchmark.</strong> Nem használ <code>category:purchases</code> korlátozást, és az AI az előszűrő által kihagyott leveleket is megvizsgálja. Audit módban nem hoz létre automatikusan rendelést.</div>
      ${working?`<div class="scan-review-status"><strong>Ellenőrzés folyamatban…</strong><span>${progress} email eredménye már elkészült. A lista folyamatosan bővül.</span></div>`:''}
      ${summaryHtml(data)}
      <button id="scan-review-refresh" class="scan-review-refresh" type="button">Eredmények frissítése</button>
      <div class="scan-review-list">${data.items.length?data.items.map(cardHtml).join(''):`<div class="scan-review-empty">Még nincs ${windowDays} napos audit. Indítsd el az ellenőrzést.</div>`}</div>`;
    body.querySelector<HTMLButtonElement>('#scan-review-refresh')?.addEventListener('click',()=>void render(connectionId,windowDays));
    const byId=new Map(data.items.map(item=>[item.sourceEmailId,item]));
    body.querySelectorAll<HTMLButtonElement>('.scan-add-button').forEach(button=>button.addEventListener('click',()=>{const card=button.closest<HTMLElement>('[data-source-id]');const item=card?.dataset.sourceId?byId.get(card.dataset.sourceId):undefined;if(item)void addPurchase(connectionId,item,button)}));
    if(working)window.setTimeout(()=>void render(connectionId,windowDays),4000);
  }catch{body.innerHTML='<div class="scan-review-error">Az eredmények most nem tölthetők be. Próbáld újra.</div>'}
}

async function openReview(connectionId:string,windowDays:BuyFlowAuditWindow){
  selectedWindow=windowDays;
  close();
  const overlay=document.createElement('div');overlay.id='buyflow-scan-review-overlay';overlay.className='scan-review-overlay';
  overlay.innerHTML=`<div class="scan-review-backdrop" data-scan-close></div><section class="scan-review-sheet" role="dialog" aria-modal="true"><header class="scan-review-header"><div><p>BUYFLOW AI BENCHMARK</p><h2>${windowDays} napos ellenőrzés</h2></div><button class="scan-review-close" type="button" data-scan-close>×</button></header><div id="scan-review-body"><div class="scan-review-status"><strong>Betöltés…</strong></div></div></section>`;
  overlay.querySelectorAll('[data-scan-close]').forEach(el=>el.addEventListener('click',close));document.body.appendChild(overlay);await render(connectionId,windowDays);
}

async function startAudit(connectionId:string,windowDays:BuyFlowAuditWindow,button:HTMLButtonElement){
  button.disabled=true;button.textContent=`${windowDays} nap állapotának ellenőrzése…`;
  try{
    const current=await request<AuditResponse>(`/api/email-connections/${encodeURIComponent(connectionId)}/audit?windowDays=${windowDays}`);
    const alreadyWorking=Boolean(current.audit&&['pending','processing','retry'].includes(current.audit.status));
    if(alreadyWorking){
      await openReview(connectionId,windowDays);
      return;
    }

    button.textContent=`${windowDays} nap ellenőrzése indul…`;
    await request(`/api/email-connections/${encodeURIComponent(connectionId)}/audit`,{method:'POST',body:JSON.stringify({windowDays})});
    await openReview(connectionId,windowDays);
  }catch{
    try{
      const latest=await request<AuditResponse>(`/api/email-connections/${encodeURIComponent(connectionId)}/audit?windowDays=${windowDays}`);
      const working=Boolean(latest.audit&&['pending','processing','retry'].includes(latest.audit.status));
      if(working){
        await openReview(connectionId,windowDays);
        return;
      }
    }catch{
      // Fall through to the user-facing error.
    }
    window.alert(`Most nem sikerült elindítani a teljes ${windowDays} napos AI ellenőrzést.`);
  }
  finally{button.disabled=false;button.textContent=`Teljes ${windowDays} napos AI ellenőrzés indítása`}
}

function updateWindowButtons(actions:HTMLElement){
  actions.querySelectorAll<HTMLButtonElement>('[data-audit-window]').forEach(button=>{
    const window=Number(button.dataset.auditWindow) as BuyFlowAuditWindow;
    button.classList.toggle('active',window===selectedWindow);
  });
  const start=actions.querySelector<HTMLButtonElement>('#start-full-ai-audit');if(start)start.textContent=`Teljes ${selectedWindow} napos AI ellenőrzés indítása`;
  const view=actions.querySelector<HTMLButtonElement>('#view-full-ai-audit');if(view)view.textContent=`${selectedWindow} nap eredményeinek megtekintése`;
}

async function enhanceSettings(){
  const container=document.querySelector<HTMLElement>('#gmail-connection-content.connected');if(!container||container.dataset.scanReviewEnhanced==='1')return;
  container.dataset.scanReviewEnhanced='1';
  try{
    const connection=await activeConnection();if(!connection)return;
    const actions=document.createElement('div');actions.className='scan-review-actions';
    actions.innerHTML=`<div class="scan-window-picker"><span>AI ellenőrzés időszaka</span><div class="scan-window-options">${BUYFLOW_AUDIT_WINDOWS.map(window=>`<button type="button" data-audit-window="${window}">${window} nap</button>`).join('')}</div><small>Alapértelmezett: 30 nap. A 90 nap több tanulási/tesztadatot ad, ezért tovább tarthat.</small></div><button id="start-full-ai-audit" class="scan-review-button primary" type="button"></button><button id="view-full-ai-audit" class="scan-review-button secondary" type="button"></button>`;
    container.appendChild(actions);updateWindowButtons(actions);
    actions.querySelectorAll<HTMLButtonElement>('[data-audit-window]').forEach(button=>button.addEventListener('click',()=>{const value=Number(button.dataset.auditWindow);if(BUYFLOW_AUDIT_WINDOWS.includes(value as BuyFlowAuditWindow)){selectedWindow=value as BuyFlowAuditWindow;updateWindowButtons(actions)}}));
    actions.querySelector<HTMLButtonElement>('#start-full-ai-audit')?.addEventListener('click',event=>void startAudit(connection.id,selectedWindow,event.currentTarget as HTMLButtonElement));
    actions.querySelector<HTMLButtonElement>('#view-full-ai-audit')?.addEventListener('click',()=>void openReview(connection.id,selectedWindow));
  }catch{container.dataset.scanReviewEnhanced='0'}
}

const observer=new MutationObserver(()=>void enhanceSettings());observer.observe(document.documentElement,{childList:true,subtree:true});void enhanceSettings();
document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});