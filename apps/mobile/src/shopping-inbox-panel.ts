import { loadShoppingInbox, type ShoppingInboxData, type ShoppingInboxMessage } from './api.js';
import { supabase } from './supabase.js';
import './shopping-inbox-panel.css';

let loading = false;
let cached: ShoppingInboxData | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function envelopeIcon(size = 21): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>`;
}

function closeInbox() {
  document.querySelector('#buyflow-shopping-inbox-overlay')?.remove();
}

function formatDate(value: string | null): string {
  if (!value) return 'Időpont nélkül';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Időpont nélkül';
  return new Intl.DateTimeFormat('hu-HU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function classificationLabel(message: ShoppingInboxMessage): string {
  const labels: Record<string, string> = {
    order_created: 'Rendelés',
    order_updated: 'Rendelés frissítés',
    payment_completed: 'Fizetés',
    shipment: 'Csomag',
    delivery: 'Kézbesítés',
    invoice_or_receipt: 'Számla',
    refund: 'Visszatérítés',
    return: 'Visszaküldés',
    security_quarantine: 'Ellenőrzés',
    security_rejected: 'Blokkolva',
  };
  return labels[message.classification ?? ''] ?? 'Üzenet';
}

function statusClass(message: ShoppingInboxMessage): string {
  if (message.classification === 'security_rejected') return 'blocked';
  if (message.processingStatus === 'review' || message.classification === 'security_quarantine') return 'review';
  if (message.linkedPurchaseId) return 'linked';
  return 'neutral';
}

function messageCard(message: ShoppingInboxMessage): string {
  const sender = message.fromAddress || 'Ismeretlen feladó';
  const subject = message.subject || 'Tárgy nélküli üzenet';
  const linked = message.linkedPurchaseId
    ? '<span class="shopping-inbox-linked">Rendeléshez kapcsolva</span>'
    : '';
  return `
    <article class="shopping-inbox-message">
      <div class="shopping-inbox-message-icon">${envelopeIcon(19)}</div>
      <div class="shopping-inbox-message-main">
        <div class="shopping-inbox-message-top">
          <span class="shopping-inbox-type ${statusClass(message)}">${escapeHtml(classificationLabel(message))}</span>
          <time>${escapeHtml(formatDate(message.receivedAt))}</time>
        </div>
        <strong>${escapeHtml(subject)}</strong>
        <small>${escapeHtml(sender)}</small>
        ${linked}
      </div>
    </article>
  `;
}

function emptyState(data: ShoppingInboxData): string {
  if (!data.assigned) {
    return `
      <div class="shopping-inbox-empty">
        <div class="shopping-inbox-empty-icon">@</div>
        <strong>Még nincs BuyFlow email címed</strong>
        <p>Először hozz létre egy saját <b>@buyflow.hu</b> címet a Profil és BuyFlow email menüben.</p>
      </div>
    `;
  }
  return `
    <div class="shopping-inbox-empty">
      <div class="shopping-inbox-empty-icon">${envelopeIcon(28)}</div>
      <strong>Még nincs üzeneted</strong>
      <p>Ha webshopos levelek érkeznek a <b>${escapeHtml(data.emailAddress)}</b> címre, itt fognak megjelenni.</p>
    </div>
  `;
}

function contentHtml(data: ShoppingInboxData): string {
  const messages = data.messages.length > 0
    ? `<div class="shopping-inbox-list">${data.messages.map(messageCard).join('')}</div>`
    : emptyState(data);
  return `
    <section class="shopping-inbox-address-card">
      <span>SAJÁT VÁSÁRLÁSI EMAIL</span>
      <strong>${escapeHtml(data.emailAddress || 'Még nincs létrehozva')}</strong>
      <small>${data.assigned ? 'A webshopos értesítések ide érkezhetnek.' : 'Hozd létre a saját BuyFlow címedet.'}</small>
    </section>
    <div class="shopping-inbox-section-head">
      <div><span>BEÉRKEZETT</span><h3>Üzenetek</h3></div>
      <button id="shopping-inbox-refresh" type="button" aria-label="Frissítés">↻</button>
    </div>
    ${messages}
  `;
}

async function currentToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('SESSION_REQUIRED');
  return data.session.access_token;
}

async function renderBody(force = false) {
  const body = document.querySelector<HTMLElement>('#shopping-inbox-body');
  if (!body || loading) return;
  if (cached && !force) {
    body.innerHTML = contentHtml(cached);
    bindBody();
    return;
  }

  loading = true;
  body.innerHTML = '<div class="shopping-inbox-loading"><div class="spinner small"></div><span>Üzenetek betöltése…</span></div>';
  try {
    const token = await currentToken();
    cached = await loadShoppingInbox(token, 50);
    if (!document.querySelector('#buyflow-shopping-inbox-overlay')) return;
    body.innerHTML = contentHtml(cached);
    bindBody();
  } catch {
    if (!document.querySelector('#buyflow-shopping-inbox-overlay')) return;
    body.innerHTML = '<div class="shopping-inbox-error"><strong>Az üzenetek most nem tölthetők be.</strong><span>Próbáld újra később.</span><button id="shopping-inbox-refresh" type="button">Újra</button></div>';
    bindBody();
  } finally {
    loading = false;
  }
}

function bindBody() {
  document.querySelector<HTMLButtonElement>('#shopping-inbox-refresh')?.addEventListener('click', () => {
    cached = null;
    void renderBody(true);
  });
}

function openInbox() {
  closeInbox();
  const overlay = document.createElement('div');
  overlay.id = 'buyflow-shopping-inbox-overlay';
  overlay.className = 'shopping-inbox-overlay';
  overlay.innerHTML = `
    <div class="shopping-inbox-backdrop" data-inbox-close></div>
    <section class="shopping-inbox-sheet" role="dialog" aria-modal="true" aria-label="BuyFlow Üzenetek">
      <header class="shopping-inbox-header">
        <div><p>SHOPPING INBOX</p><h2>Üzenetek</h2></div>
        <button type="button" data-inbox-close aria-label="Bezárás">×</button>
      </header>
      <div id="shopping-inbox-body"></div>
    </section>
  `;
  overlay.querySelectorAll<HTMLElement>('[data-inbox-close]').forEach((element) => element.addEventListener('click', closeInbox));
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  void renderBody();
}

function enhanceNavigation() {
  const discovery = document.querySelector<HTMLButtonElement>('.bottom-nav [data-route="discovery"]');
  if (!discovery || discovery.dataset.shoppingInbox === '1') return;
  discovery.dataset.shoppingInbox = '1';
  discovery.removeAttribute('data-route');
  discovery.setAttribute('aria-label', 'Üzenetek');
  discovery.innerHTML = `${envelopeIcon(21)}<span>Üzenetek</span>`;
  discovery.addEventListener('click', openInbox);
}

const observer = new MutationObserver(enhanceNavigation);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceNavigation();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeInbox();
});
