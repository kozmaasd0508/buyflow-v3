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

function humanState(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    processing: 'Feldolgozás alatt', ordered: 'Megrendelve', paid: 'Fizetve', shipped: 'Úton van',
    in_transit: 'Úton van', out_for_delivery: 'Ma érkezhet', ready_for_pickup: 'Átvehető',
    delivered: 'Kézbesítve', cancelled: 'Törölve', refunded: 'Visszatérítve', review: 'Ellenőrzés alatt', pending: 'Függőben',
  };
  return labels[value ?? ''] ?? (value ? value.replaceAll('_', ' ') : 'Ismeretlen');
}

function currentMessage(purchase: PurchaseDetail): { title: string; body: string; tone: string } {
  if (purchase.currentState === 'delivered' || purchase.deliveredAt) return { title: 'A rendelés megérkezett', body: purchase.documents.length > 0 ? 'A kézbesítés kész, és a BuyFlow a kapcsolódó dokumentumokat is eltárolta.' : 'A kézbesítés kész. Ha később számla vagy garanciaadat érkezik, ugyanitt fog megjelenni.', tone: 'success' };
  if (purchase.currentState === 'cancelled' || purchase.cancelledAt) return { title: 'A rendelés törölve lett', body: 'A BuyFlow ezt a vásárlást lezárt, törölt életútként kezeli.', tone: 'danger' };
  if (purchase.currentState === 'refunded') return { title: 'Visszatérítés rögzítve', body: 'A BuyFlow visszatérített állapotot lát ennél a vásárlásnál.', tone: 'success' };
  if (purchase.shipments.length > 0 || purchase.shippedAt || ['shipped', 'in_transit', 'out_for_delivery'].includes(purchase.currentState)) {
    const shipment = purchase.shipments[0];
    return { title: shipment?.status === 'out_for_delivery' ? 'A csomag ma érkezhet' : 'A csomag úton van', body: shipment?.trackingNumber ? 'A futáradat és a tracking már össze van kötve a rendeléseddel.' : 'A BuyFlow már lát szállítási eseményt, a következő biztos állapotot automatikusan frissíti.', tone: 'active' };
  }
  if (purchase.paymentStatus === 'paid' || purchase.paidAt) return { title: 'Fizetés rendben', body: 'A rendelés rögzítve van. Most a biztos feladási vagy futáradatot várjuk.', tone: 'active' };
  if (purchase.currentState === 'review') return { title: 'A BuyFlow még ellenőrzi', body: 'A rendelés látható, de egy következő email vagy futáradat még pontosíthatja az állapotát.', tone: 'warning' };
  return { title: 'A rendelés rögzítve van', body: 'A következő webshop- vagy futáreseménynél a BuyFlow automatikusan frissíti ezt az oldalt.', tone: 'active' };
}

function overviewHtml(purchase: PurchaseDetail): string {
  const message = currentMessage(purchase);
  const shipment = purchase.shipments[0];
  const lastActivity = [purchase.updatedAt, shipment?.lastEventAt, purchase.deliveredAt, purchase.shippedAt, purchase.paidAt, purchase.orderedAt]
    .filter((value): value is string => Boolean(value)).sort((a, b) => b.localeCompare(a))[0] ?? purchase.createdAt;
  const carrier = shipment?.carrier || purchase.expectedCarrier || 'Még nincs futár';
  const tracking = shipment?.trackingNumber || 'Még nincs tracking';
  return `<section class="buyflow-detail-overview" data-buyflow-detail-overview="ready"><article class="buyflow-status-card ${escapeHtml(message.tone)}"><div class="buyflow-status-kicker">AKTUÁLIS HELYZET</div><div class="buyflow-status-main"><div><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.body)}</p></div><span class="buyflow-status-pill">${escapeHtml(humanState(purchase.currentState))}</span></div><div class="buyflow-status-grid"><div><small>Futár</small><strong>${escapeHtml(carrier)}</strong></div><div><small>Tracking</small><strong class="mono">${escapeHtml(tracking)}</strong></div><div><small>Termék</small><strong>${purchase.products.length} db</strong></div><div><small>Dokumentum</small><strong>${purchase.documents.length} db</strong></div></div><div class="buyflow-status-updated">Utolsó biztos frissítés: ${escapeHtml(formatDateTime(lastActivity))}</div></article></section>`;
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
