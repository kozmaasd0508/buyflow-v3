import { loadPurchase, type PurchaseDetail } from './api.js';
import { supabase } from './supabase.js';
import './purchase-detail-overview-panel.css';

let selectedPurchaseId: string | null = null;
let loadingPurchaseId: string | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Még nincs adat';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Még nincs adat';
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function overviewHtml(purchase: PurchaseDetail): string {
  const pulse = purchase.pulse;
  const shipment = purchase.shipments[0];
  const carrier = shipment?.carrier || purchase.expectedCarrier || 'Még nincs futár';
  const tracking = shipment?.trackingNumber || 'Még nincs tracking';
  return `<section class="buyflow-detail-overview" data-buyflow-detail-overview="ready"><article class="buyflow-status-card ${escapeHtml(pulse.tone)}"><div class="buyflow-status-kicker">AKTUÁLIS HELYZET</div><div class="buyflow-status-main"><div><h2>${escapeHtml(pulse.title)}</h2><p>${escapeHtml(pulse.body)}</p></div><span class="buyflow-status-pill">${escapeHtml(pulse.label)}</span></div><div class="buyflow-status-grid"><div><small>Futár</small><strong>${escapeHtml(carrier)}</strong></div><div><small>Tracking</small><strong class="mono">${escapeHtml(tracking)}</strong></div><div><small>Termék</small><strong>${purchase.products.length} db</strong></div><div><small>Dokumentum</small><strong>${purchase.documents.length} db</strong></div></div><div class="buyflow-status-updated">Utolsó biztos frissítés: ${escapeHtml(formatDateTime(pulse.lastConfirmedAt))}</div></article></section>`;
}

function insertLoading(detailPage: Element): HTMLElement | null {
  if (detailPage.querySelector('.buyflow-detail-overview')) return null;
  const hero = detailPage.querySelector('.order-hero');
  if (!hero) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = '<section class="buyflow-detail-overview" data-buyflow-detail-overview="loading"><div class="loading-card"><div class="spinner small"></div>Rendelés állapotának frissítése…</div></section>';
  const section = wrapper.firstElementChild as HTMLElement | null;
  if (!section) return null;
  hero.insertAdjacentElement('afterend', section);
  return section;
}

async function renderOverview() {
  const detailPage = document.querySelector('.detail-page');
  if (!detailPage || !selectedPurchaseId) return;
  if (detailPage.querySelector('[data-buyflow-detail-overview="ready"]')) return;
  if (loadingPurchaseId === selectedPurchaseId) return;
  const target = detailPage.querySelector<HTMLElement>('.buyflow-detail-overview') ?? insertLoading(detailPage);
  if (!target) return;
  const purchaseId = selectedPurchaseId;
  loadingPurchaseId = purchaseId;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('SESSION_EXPIRED');
    const purchase = await loadPurchase(token, purchaseId);
    if (selectedPurchaseId !== purchaseId || !target.isConnected) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = overviewHtml(purchase);
    const replacement = wrapper.firstElementChild;
    if (replacement) target.replaceWith(replacement);
  } catch {
    if (target.isConnected) { target.dataset.buyflowDetailOverview = 'ready'; target.innerHTML = '<div class="detail-empty">Az aktuális összefoglaló most nem tölthető be.</div>'; }
  } finally {
    if (loadingPurchaseId === purchaseId) loadingPurchaseId = null;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-purchase-id]') : null;
  const purchaseId = target?.dataset.purchaseId;
  if (purchaseId) selectedPurchaseId = purchaseId;
}, true);

const observer = new MutationObserver(() => { void renderOverview(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
