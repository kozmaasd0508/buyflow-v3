import { loadPurchase, type PurchaseDetail } from './api.js';
import { supabase } from './supabase.js';
import './purchase-timeline-panel.css';

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

function formatDateTime(value: string | null): string {
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

interface TimelineEvent {
  key: string;
  label: string;
  description: string;
  at: string | null;
  status: 'done' | 'current' | 'future' | 'stopped';
}

function lifecycleEvents(purchase: PurchaseDetail): TimelineEvent[] {
  const cancelled = Boolean(purchase.cancelledAt || purchase.currentState === 'cancelled');
  const delivered = Boolean(purchase.deliveredAt || purchase.currentState === 'delivered');
  const shipped = Boolean(purchase.shippedAt || delivered || ['shipped', 'in_transit'].includes(purchase.currentState));
  const paid = Boolean(purchase.paidAt || purchase.paymentStatus === 'paid');
  const ordered = Boolean(purchase.orderedAt || purchase.createdAt);

  const events: TimelineEvent[] = [
    {
      key: 'ordered',
      label: 'Rendelés létrejött',
      description: 'A BuyFlow felismerte a vásárlást.',
      at: purchase.orderedAt || purchase.createdAt,
      status: ordered ? 'done' : 'future',
    },
    {
      key: 'paid',
      label: 'Fizetés',
      description: paid ? 'A fizetés sikeresként ismert.' : 'Még nincs biztos sikeres fizetési bizonyíték.',
      at: purchase.paidAt,
      status: paid ? 'done' : cancelled ? 'stopped' : 'future',
    },
    {
      key: 'shipped',
      label: 'Feladva / úton',
      description: shipped ? 'A rendeléshez szállítási esemény tartozik.' : 'Még nincs biztos feladási esemény.',
      at: purchase.shippedAt,
      status: shipped ? 'done' : cancelled ? 'stopped' : 'future',
    },
    {
      key: 'delivered',
      label: 'Kézbesítve',
      description: delivered ? 'A rendelést kézbesítettként ismerjük.' : 'Még nincs kézbesítési bizonyíték.',
      at: purchase.deliveredAt,
      status: delivered ? 'done' : cancelled ? 'stopped' : 'future',
    },
  ];

  if (cancelled) {
    events.push({
      key: 'cancelled',
      label: 'Rendelés törölve',
      description: 'A vásárlási életút törölt állapotban van.',
      at: purchase.cancelledAt,
      status: 'stopped',
    });
  }

  const firstFuture = events.findIndex((event) => event.status === 'future');
  if (firstFuture >= 0 && !cancelled) {
    events[firstFuture]!.status = 'current';
  }

  return events;
}

function timelineHtml(purchase: PurchaseDetail): string {
  const events = lifecycleEvents(purchase);
  return `
    <section class="content-section buyflow-timeline-section" data-buyflow-timeline="ready">
      <div class="section-head">
        <div>
          <p class="eyebrow">VÁSÁRLÁS ÉLETÚTJA</p>
          <h2>Mi történt eddig?</h2>
        </div>
      </div>
      <div class="buyflow-timeline-card">
        ${events.map((event, index) => `
          <div class="buyflow-timeline-row ${event.status}">
            <div class="buyflow-timeline-rail">
              <span class="buyflow-timeline-dot">${event.status === 'done' ? '✓' : event.status === 'stopped' ? '×' : ''}</span>
              ${index < events.length - 1 ? '<span class="buyflow-timeline-line"></span>' : ''}
            </div>
            <div class="buyflow-timeline-copy">
              <div class="buyflow-timeline-title"><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(formatDateTime(event.at))}</span></div>
              <small>${escapeHtml(event.description)}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function insertLoadingSection(detailPage: Element): HTMLElement | null {
  if (detailPage.querySelector('.buyflow-timeline-section')) return null;
  const hero = detailPage.querySelector('.order-hero');
  if (!hero) return null;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <section class="content-section buyflow-timeline-section" data-buyflow-timeline="loading">
      <div class="section-head"><div><p class="eyebrow">VÁSÁRLÁS ÉLETÚTJA</p><h2>Mi történt eddig?</h2></div></div>
      <div class="loading-card"><div class="spinner small"></div>Életút betöltése…</div>
    </section>
  `;
  const section = wrapper.firstElementChild as HTMLElement | null;
  if (!section) return null;
  hero.insertAdjacentElement('afterend', section);
  return section;
}

async function renderTimeline() {
  const detailPage = document.querySelector('.detail-page');
  if (!detailPage || !selectedPurchaseId) return;
  if (detailPage.querySelector('[data-buyflow-timeline="ready"]')) return;
  if (loadingPurchaseId === selectedPurchaseId) return;

  const target = detailPage.querySelector<HTMLElement>('.buyflow-timeline-section')
    ?? insertLoadingSection(detailPage);
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
    wrapper.innerHTML = timelineHtml(purchase);
    const replacement = wrapper.firstElementChild;
    if (replacement) target.replaceWith(replacement);
  } catch {
    if (target.isConnected) {
      target.dataset.buyflowTimeline = 'ready';
      target.innerHTML = `
        <div class="section-head"><div><p class="eyebrow">VÁSÁRLÁS ÉLETÚTJA</p><h2>Mi történt eddig?</h2></div></div>
        <div class="detail-empty">Az életút most nem tölthető be.</div>
      `;
    }
  } finally {
    if (loadingPurchaseId === purchaseId) loadingPurchaseId = null;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-purchase-id]')
    : null;
  const purchaseId = target?.dataset.purchaseId;
  if (purchaseId) selectedPurchaseId = purchaseId;
}, true);

const observer = new MutationObserver(() => {
  void renderTimeline();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
