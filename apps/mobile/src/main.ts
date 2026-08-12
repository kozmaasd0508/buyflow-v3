import type { Session } from '@supabase/supabase-js';
import { loadPurchase, loadPurchases, type PurchaseDetail, type PurchaseSummary } from './api.js';
import { supabase } from './supabase.js';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

interface AppState {
  initialized: boolean;
  session: Session | null;
  purchases: PurchaseSummary[];
  selectedPurchase: PurchaseDetail | null;
  loading: boolean;
  error: string | null;
}

const state: AppState = {
  initialized: false,
  session: null,
  purchases: [],
  selectedPurchase: null,
  loading: false,
  error: null,
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '—';

  if (currency) {
    try {
      return new Intl.NumberFormat('hu-HU', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'HUF' ? 0 : 2,
      }).format(numeric);
    } catch {
      // Fall through to a safe plain rendering for unknown currency codes.
    }
  }

  return `${new Intl.NumberFormat('hu-HU').format(numeric)}${currency ? ` ${escapeHtml(currency)}` : ''}`;
}

function stateLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    processing: 'Feldolgozás alatt',
    ordered: 'Megrendelve',
    paid: 'Fizetve',
    shipped: 'Úton van',
    delivered: 'Kézbesítve',
    cancelled: 'Törölve',
    refunded: 'Visszatérítve',
    review: 'Ellenőrzés alatt',
    pending: 'Függőben',
  };
  return labels[value ?? ''] ?? (value ? value.replaceAll('_', ' ') : 'Ismeretlen');
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function setError(message: string | null) {
  state.error = message;
  render();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'SESSION_EXPIRED') return 'A bejelentkezés lejárt. Kérlek, lépj be újra.';
    if (error.message.startsWith('API_')) return 'A BuyFlow szerver most nem elérhető. Próbáld újra pár pillanat múlva.';
  }
  return 'Valami nem sikerült. Kérlek, próbáld újra.';
}

function renderLoading() {
  root.innerHTML = `
    <main class="screen centered-screen">
      <div class="brand-mark" aria-hidden="true">B</div>
      <div class="spinner" aria-label="Betöltés"></div>
      <p class="muted">BuyFlow betöltése…</p>
    </main>
  `;
}

function renderLogin() {
  const error = state.error
    ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>`
    : '';

  root.innerHTML = `
    <main class="screen login-screen">
      <section class="login-card">
        <div class="brand-row">
          <div class="brand-mark" aria-hidden="true">B</div>
          <div>
            <div class="eyebrow">BUYFLOW</div>
            <h1>Minden vásárlásod egy helyen.</h1>
          </div>
        </div>

        <p class="lead">
          Rendelések, csomagkövetés és számlák automatikusan összerendezve.
        </p>

        ${error}

        <form id="login-form" class="form-stack" novalidate>
          <label>
            <span>Email cím</span>
            <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="nev@email.hu" />
          </label>

          <label>
            <span>Jelszó</span>
            <input id="password" name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="••••••••" />
          </label>

          <button class="primary-button" type="submit" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? 'Belépés…' : 'Belépés'}
          </button>
        </form>

        <p class="security-note">A jelszavadat a BuyFlow backend nem kapja meg; a belépést a Supabase kezeli.</p>
      </section>
    </main>
  `;

  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', (event) => {
    void handleLogin(event);
  });
}

function purchaseCard(purchase: PurchaseSummary): string {
  const shipment = purchase.shipments[0];
  const merchant = purchase.merchantName || purchase.merchantDomain || 'Ismeretlen webshop';
  const orderNumber = purchase.orderNumber ? `#${purchase.orderNumber}` : 'Rendelési szám nélkül';
  const shipmentLine = shipment
    ? `${escapeHtml(shipment.carrier || 'Futár')} · ${escapeHtml(stateLabel(shipment.status))}`
    : 'Még nincs csomagadat';

  return `
    <button class="purchase-card" type="button" data-purchase-id="${escapeHtml(purchase.id)}">
      <div class="purchase-card-top">
        <div>
          <div class="merchant-name">${escapeHtml(merchant)}</div>
          <div class="order-number">${escapeHtml(orderNumber)}</div>
        </div>
        <span class="status-pill status-${escapeHtml(purchase.currentState)}">${escapeHtml(stateLabel(purchase.currentState))}</span>
      </div>

      <div class="purchase-amount">${formatMoney(purchase.totalAmount, purchase.currency)}</div>

      <div class="purchase-meta">
        <span>${escapeHtml(formatDate(purchase.orderedAt || purchase.createdAt))}</span>
        <span>${escapeHtml(shipmentLine)}</span>
        <span>${purchase.documentCount} dokumentum</span>
      </div>
    </button>
  `;
}

function renderPurchases() {
  const email = state.session?.user.email ?? '';
  const error = state.error
    ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>`
    : '';

  const content = state.loading && state.purchases.length === 0
    ? `<div class="empty-card"><div class="spinner small"></div><p>Vásárlások betöltése…</p></div>`
    : state.purchases.length === 0
      ? `
        <div class="empty-card">
          <div class="empty-icon">✓</div>
          <h2>Még nincs megjeleníthető vásárlás</h2>
          <p>Amint a BuyFlow biztosan felismer egy rendelést, itt fog megjelenni.</p>
        </div>
      `
      : `<div class="purchase-list">${state.purchases.map(purchaseCard).join('')}</div>`;

  root.innerHTML = `
    <main class="screen app-screen">
      <header class="app-header">
        <div>
          <div class="eyebrow">BUYFLOW</div>
          <h1>Vásárlásaim</h1>
          <p class="account-email">${escapeHtml(email)}</p>
        </div>
        <button id="logout-button" class="icon-button" type="button" aria-label="Kijelentkezés">↪</button>
      </header>

      <section class="summary-strip">
        <div><strong>${state.purchases.length}</strong><span>vásárlás</span></div>
        <div><strong>${state.purchases.filter((purchase) => purchase.currentState === 'delivered').length}</strong><span>kézbesítve</span></div>
        <button id="refresh-button" type="button" ${state.loading ? 'disabled' : ''}>Frissítés</button>
      </section>

      ${error}
      ${content}
    </main>
  `;

  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', () => {
    void supabase.auth.signOut();
  });

  document.querySelector<HTMLButtonElement>('#refresh-button')?.addEventListener('click', () => {
    void refreshPurchases();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-purchase-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.purchaseId;
      if (id) void openPurchase(id);
    });
  });
}

function shipmentSection(purchase: PurchaseDetail): string {
  if (purchase.shipments.length === 0) {
    return `<div class="detail-empty">Még nincs csomagkövetési adat.</div>`;
  }

  return purchase.shipments.map((shipment) => {
    const trackingUrl = safeHttpUrl(shipment.trackingUrl);
    const tracking = shipment.trackingNumber
      ? `<div class="tracking-number">${escapeHtml(shipment.trackingNumber)}</div>`
      : '<div class="muted">Nincs tracking szám</div>';
    const link = trackingUrl
      ? `<a class="secondary-button" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">Futárkövetés megnyitása</a>`
      : '';

    return `
      <article class="shipment-card">
        <div class="detail-row"><span>Futár</span><strong>${escapeHtml(shipment.carrier || 'Ismeretlen')}</strong></div>
        <div class="detail-row"><span>Állapot</span><strong>${escapeHtml(stateLabel(shipment.status))}</strong></div>
        <div class="detail-row"><span>Tracking</span><div>${tracking}</div></div>
        <div class="detail-row"><span>Kézbesítve</span><strong>${escapeHtml(formatDate(shipment.deliveredAt))}</strong></div>
        ${link}
      </article>
    `;
  }).join('');
}

function documentsSection(purchase: PurchaseDetail): string {
  if (purchase.documents.length === 0) {
    return `<div class="detail-empty">Még nincs számla vagy dokumentum.</div>`;
  }

  return purchase.documents.map((document) => {
    const url = safeHttpUrl(document.externalUrl);
    const title = document.type === 'invoice' ? 'Számla' : document.type;
    const number = document.documentNumber || document.filename || 'Azonosító nélkül';
    const link = url
      ? `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Megnyitás</a>`
      : '';

    return `
      <article class="document-row">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(number)} · ${escapeHtml(formatDate(document.issuedAt || document.createdAt))}</span>
        </div>
        ${link}
      </article>
    `;
  }).join('');
}

function renderPurchaseDetail() {
  const purchase = state.selectedPurchase;
  if (!purchase) {
    renderPurchases();
    return;
  }

  const merchant = purchase.merchantName || purchase.merchantDomain || 'Ismeretlen webshop';
  const error = state.error
    ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>`
    : '';

  root.innerHTML = `
    <main class="screen app-screen detail-screen">
      <header class="detail-header">
        <button id="back-button" class="icon-button" type="button" aria-label="Vissza">←</button>
        <div>
          <div class="eyebrow">RENDELÉS</div>
          <h1>${escapeHtml(merchant)}</h1>
          <p class="account-email">${purchase.orderNumber ? `#${escapeHtml(purchase.orderNumber)}` : 'Rendelési szám nélkül'}</p>
        </div>
      </header>

      ${error}

      <section class="hero-status-card">
        <span class="status-pill status-${escapeHtml(purchase.currentState)}">${escapeHtml(stateLabel(purchase.currentState))}</span>
        <div class="hero-amount">${formatMoney(purchase.totalAmount, purchase.currency)}</div>
        <div class="hero-date">${escapeHtml(formatDate(purchase.orderedAt || purchase.createdAt))}</div>
      </section>

      <section class="detail-section">
        <h2>Rendelés</h2>
        <div class="detail-card">
          <div class="detail-row"><span>Rendelési szám</span><strong>${escapeHtml(purchase.orderNumber || '—')}</strong></div>
          <div class="detail-row"><span>Fizetés</span><strong>${escapeHtml(purchase.paymentStatus ? stateLabel(purchase.paymentStatus) : '—')}</strong></div>
          <div class="detail-row"><span>Fizetési mód</span><strong>${escapeHtml(purchase.paymentMethod || '—')}</strong></div>
          <div class="detail-row"><span>Összeg</span><strong>${formatMoney(purchase.totalAmount, purchase.currency)}</strong></div>
        </div>
      </section>

      <section class="detail-section">
        <h2>Csomagkövetés</h2>
        ${shipmentSection(purchase)}
      </section>

      <section class="detail-section">
        <h2>Dokumentumok</h2>
        <div class="detail-card documents-card">${documentsSection(purchase)}</div>
      </section>
    </main>
  `;

  document.querySelector<HTMLButtonElement>('#back-button')?.addEventListener('click', () => {
    state.selectedPurchase = null;
    state.error = null;
    render();
  });
}

function render() {
  if (!state.initialized) {
    renderLoading();
    return;
  }

  if (!state.session) {
    renderLogin();
    return;
  }

  if (state.selectedPurchase) {
    renderPurchaseDetail();
    return;
  }

  renderPurchases();
}

async function handleLogin(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    setError('Add meg az email címedet és a jelszavadat.');
    return;
  }

  state.loading = true;
  state.error = null;
  render();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    state.loading = false;
    state.error = 'Hibás email cím vagy jelszó.';
    render();
    return;
  }

  state.session = data.session;
  state.loading = false;
  await refreshPurchases();
}

async function refreshPurchases() {
  const session = state.session;
  if (!session) return;

  state.loading = true;
  state.error = null;
  render();

  try {
    state.purchases = await loadPurchases(session.access_token);
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      await supabase.auth.signOut();
      state.error = 'A bejelentkezés lejárt. Kérlek, lépj be újra.';
      return;
    }
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function openPurchase(purchaseId: string) {
  const session = state.session;
  if (!session) return;

  state.loading = true;
  state.error = null;
  render();

  try {
    state.selectedPurchase = await loadPurchase(session.access_token, purchaseId);
  } catch (error) {
    state.error = errorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  state.session = session;

  if (!session) {
    state.purchases = [];
    state.selectedPurchase = null;
    state.loading = false;
  }

  if (event === 'TOKEN_REFRESHED' && session) {
    // Future API calls automatically use the new access token stored in state.
  }

  render();
});

const { data: initialSession } = await supabase.auth.getSession();
state.session = initialSession.session;
state.initialized = true;
render();

if (state.session) {
  await refreshPurchases();
}
