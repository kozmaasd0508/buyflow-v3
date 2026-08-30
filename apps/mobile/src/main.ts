import type { Session } from '@supabase/supabase-js';
import { loadPurchase, loadPurchases, type PurchaseDetail, type PurchaseSummary } from './api.js';
import { renderPurchaseDetailEnhancements } from './purchase-detail-controller.js';
import { supabase } from './supabase.js';
import './styles.css';

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('Missing #app root');
const root: HTMLDivElement = rootElement;

const PASSWORD_RESET_URL = 'https://buyflow-v3-api-dev.onrender.com/auth/reset-password';

type Route = 'home' | 'orders' | 'purchases' | 'discovery' | 'flow';

interface AppState {
  initialized: boolean;
  session: Session | null;
  purchases: PurchaseSummary[];
  selectedPurchase: PurchaseDetail | null;
  route: Route;
  loading: boolean;
  accountOpen: boolean;
  error: string | null;
  notice: string | null;
}

const state: AppState = {
  initialized: false,
  session: null,
  purchases: [],
  selectedPurchase: null,
  route: 'home',
  loading: false,
  accountOpen: false,
  error: null,
  notice: null,
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cssToken(value: string | null | undefined): string {
  return String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
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
      // Unknown currency codes fall through to a plain safe rendering.
    }
  }

  return `${new Intl.NumberFormat('hu-HU').format(numeric)}${currency ? ` ${escapeHtml(currency)}` : ''}`;
}

function stateLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    processing: 'Feldolgozás alatt',
    ordered: 'Megrendelve',
    paid: 'Fizetve',
    shipment_created: 'Csomag létrehozva',
    shipped: 'Feladva',
    in_transit: 'Úton van',
    out_for_delivery: 'Ma érkezhet',
    ready_for_pickup: 'Átvehető',
    delivered: 'Kézbesítve',
    delivery_failed: 'Sikertelen kézbesítés',
    delayed: 'Késik',
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

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 10) return 'Jó reggelt';
  if (hour < 18) return 'Szép napot';
  return 'Jó estét';
}

function icon(name: string, size = 22): string {
  const paths: Record<string, string> = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    box: '<path d="m4 7 8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/>',
    store: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M8 20v-6h8v6"/><path d="M3 10c0 2 4 2 4 0 0 2 5 2 5 0 0 2 5 2 5 0 0 2 4 2 4 0"/>',
    spark: '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M10 4H5v16h5"/><path d="m14 8 4 4-4 4"/><path d="M8 12h10"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
}

function ambientBackground(): string {
  return `
    <div class="ambient-stage" aria-hidden="true">
      <div class="ambient-orb ambient-orb-a"></div>
      <div class="ambient-orb ambient-orb-b"></div>
      <div class="ambient-orb ambient-orb-c"></div>
      <div class="ambient-orb ambient-orb-d"></div>
      <div class="ambient-noise"></div>
    </div>
  `;
}

function feedbackHtml(): string {
  const error = state.error ? `<div class="alert alert-error" role="alert">${escapeHtml(state.error)}</div>` : '';
  const notice = state.notice ? `<div class="alert alert-success" role="status">${escapeHtml(state.notice)}</div>` : '';
  return `${error}${notice}`;
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
    ${ambientBackground()}
    <main class="centered-screen">
      <div class="brand-mark">${icon('spark', 30)}</div>
      <div class="spinner" aria-label="Betöltés"></div>
      <p class="muted">BuyFlow betöltése…</p>
    </main>
  `;
}

function renderLogin() {
  root.innerHTML = `
    ${ambientBackground()}
    <main class="login-screen">
      <section class="auth-card glass-panel">
        <div class="auth-brand">
          <div class="brand-mark">${icon('spark', 29)}</div>
          <div>
            <strong>BuyFlow</strong>
            <small>Buyer-friendly Experience</small>
          </div>
        </div>

        <div class="auth-copy">
          <p class="eyebrow">MINDEN VÁSÁRLÁS A HELYÉN</p>
          <h1>A vásárlás után is minden a helyén.</h1>
          <p>Rendelések, csomagkövetés és dokumentumok egy érthető rendszerben.</p>
        </div>

        ${feedbackHtml()}

        <form id="login-form" class="form-stack" novalidate>
          <label>
            <span>Email cím</span>
            <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="nev@email.hu" />
          </label>
          <label>
            <span>Jelszó</span>
            <input id="password" name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="••••••••" />
          </label>
          <button class="button primary full-width" type="submit" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? 'Belépés…' : 'Belépés'}
          </button>
          <button id="forgot-password" class="button text-button" type="button" ${state.loading ? 'disabled' : ''}>Elfelejtettem a jelszót</button>
        </form>

        <div class="security-note">${icon('shield', 15)}<span>A jelszavadat a Supabase kezeli; a BuyFlow backend nem kapja meg.</span></div>
      </section>
    </main>
  `;

  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', (event) => {
    void handleLogin(event);
  });
  document.querySelector<HTMLButtonElement>('#forgot-password')?.addEventListener('click', () => {
    void handleForgotPassword();
  });
}

function purchaseCard(purchase: PurchaseSummary, variant: 'purchase' | 'order' = 'purchase'): string {
  const shipment = purchase.shipments[0];
  const merchant = purchase.merchantName || purchase.merchantDomain || 'Ismeretlen webshop';
  const orderNumber = purchase.orderNumber ? `#${purchase.orderNumber}` : 'Rendelési szám nélkül';
  const status = shipment?.status || purchase.currentState;
  const iconName = variant === 'order' ? 'truck' : 'box';
  const previewImage = safeHttpUrl(purchase.productPreviewImageUrl);
  const media = previewImage
    ? `<span class="entity-icon entity-product-image"><img src="${escapeHtml(previewImage)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
    : `<span class="entity-icon">${icon(iconName, 24)}</span>`;
  const meta = variant === 'order'
    ? `${shipment?.carrier || 'Futár még nincs'} · ${shipment?.trackingNumber ? 'Tracking elérhető' : 'Trackingre vár'}`
    : `${formatDate(purchase.orderedAt || purchase.createdAt)} · ${purchase.documentCount} dokumentum`;

  return `
    <button class="entity-card" type="button" data-purchase-id="${escapeHtml(purchase.id)}">
      ${media}
      <span class="entity-main">
        <span class="entity-top">
          <span>
            <strong class="entity-title">${escapeHtml(merchant)}</strong>
            <small>${escapeHtml(orderNumber)}</small>
          </span>
          <span class="badge badge-${cssToken(status)}">${escapeHtml(stateLabel(status))}</span>
        </span>
        <span class="entity-meta-line">${escapeHtml(meta)}</span>
        <span class="entity-bottom">
          <strong>${formatMoney(purchase.totalAmount, purchase.currency)}</strong>
          <span class="entity-chevron">${icon('chevron', 18)}</span>
        </span>
      </span>
    </button>
  `;
}

function latestPurchase(): PurchaseSummary | null {
  return state.purchases[0] ?? null;
}

function renderHomePage(): string {
  const latest = latestPurchase();
  const delivered = state.purchases.filter((purchase) => purchase.currentState === 'delivered').length;
  const inTransit = state.purchases.filter((purchase) => {
    const status = purchase.shipments[0]?.status || purchase.currentState;
    return ['shipment_created', 'shipped', 'in_transit', 'out_for_delivery', 'ready_for_pickup'].includes(status);
  }).length;
  const documents = state.purchases.reduce((sum, purchase) => sum + purchase.documentCount, 0);
  const latestCard = latest
    ? purchaseCard(latest, latest.shipments.length > 0 ? 'order' : 'purchase')
    : `<div class="empty-card"><strong>Még nincs vásárlás</strong><span>Az első biztosan felismert rendelésed itt fog megjelenni.</span></div>`;

  return `
    <section class="page home-page">
      <article class="welcome-card">
        <div class="welcome-copy">
          <p class="eyebrow">BUYFLOW</p>
          <h1>${escapeHtml(greeting())}.</h1>
          <p>${state.purchases.length > 0 ? 'A vásárlásaid rendben követhetők.' : 'Készen állunk az első vásárlásodra.'}</p>
        </div>
        <div class="welcome-orb">${icon('spark', 31)}</div>
      </article>

      <section class="content-section">
        <div class="section-head">
          <div>
            <p class="eyebrow">ÁTTEKINTÉS</p>
            <h2>Minden fontos egy pillantásra</h2>
          </div>
          <button class="round-action" type="button" data-action="refresh" aria-label="Frissítés">${icon('refresh', 19)}</button>
        </div>
        <div class="home-grid">
          <button class="insight-card" type="button" data-route="orders">
            <span class="insight-icon">${icon('truck', 21)}</span>
            <span><small>MOZGÁSBAN</small><strong>${inTransit}</strong><em>csomag</em></span>
          </button>
          <button class="insight-card" type="button" data-route="purchases">
            <span class="insight-icon">${icon('box', 21)}</span>
            <span><small>VÁSÁRLÁS</small><strong>${state.purchases.length}</strong><em>összesen</em></span>
          </button>
          <button class="insight-card" type="button" data-route="orders">
            <span class="insight-icon success-icon">${icon('shield', 21)}</span>
            <span><small>KÉZBESÍTVE</small><strong>${delivered}</strong><em>rendben</em></span>
          </button>
          <button class="insight-card" type="button" data-route="purchases">
            <span class="insight-icon">${icon('receipt', 21)}</span>
            <span><small>DOKUMENTUM</small><strong>${documents}</strong><em>elmentve</em></span>
          </button>
        </div>
      </section>

      <section class="content-section">
        <div class="section-head">
          <div>
            <p class="eyebrow">MOST FONTOS</p>
            <h2>Legutóbbi vásárlás</h2>
          </div>
        </div>
        <div class="stack">${latestCard}</div>
      </section>

      <section class="quick-grid">
        <button class="quick-card" type="button" data-route="orders">${icon('truck', 20)}<span><strong>Csomagok</strong><small>Követés és aktuális állapotok</small></span>${icon('chevron', 17)}</button>
        <button class="quick-card" type="button" data-route="purchases">${icon('receipt', 20)}<span><strong>Dokumentumok</strong><small>Számlák a vásárlásoknál</small></span>${icon('chevron', 17)}</button>
      </section>
    </section>
  `;
}

function renderOrdersPage(): string {
  const rows = state.purchases.filter((purchase) => purchase.shipments.length > 0);
  const content = rows.length > 0
    ? `<div class="stack">${rows.map((purchase) => purchaseCard(purchase, 'order')).join('')}</div>`
    : `<div class="empty-card"><strong>Még nincs követhető csomag</strong><span>Ha egy rendeléshez futáradat érkezik, itt jelenik meg.</span></div>`;

  return `
    <section class="page">
      <div class="page-title-row">
        <div><p class="eyebrow">CSOMAGKÖVETÉS</p><h1>Csomagok</h1><p>Aktuális állapotok és futáradatok egy helyen.</p></div>
        <button class="round-action" type="button" data-action="refresh" aria-label="Frissítés">${icon('refresh', 19)}</button>
      </div>
      ${feedbackHtml()}
      ${state.loading && rows.length === 0 ? '<div class="loading-card"><div class="spinner small"></div>Csomagok betöltése…</div>' : content}
    </section>
  `;
}

function renderPurchasesPage(): string {
  const content = state.purchases.length > 0
    ? `<div class="stack">${state.purchases.map((purchase) => purchaseCard(purchase)).join('')}</div>`
    : `<div class="empty-card"><strong>Még nincs megjeleníthető vásárlás</strong><span>Amint a BuyFlow biztosan felismer egy rendelést, itt fog megjelenni.</span></div>`;

  return `
    <section class="page">
      <div class="page-title-row">
        <div><p class="eyebrow">GYŰJTEMÉNY</p><h1>Vásárlások</h1><p>Rendelések, számlák és később a garanciák együtt.</p></div>
        <button class="round-action" type="button" data-action="refresh" aria-label="Frissítés">${icon('refresh', 19)}</button>
      </div>
      ${feedbackHtml()}
      ${state.loading && state.purchases.length === 0 ? '<div class="loading-card"><div class="spinner small"></div>Vásárlások betöltése…</div>' : content}
    </section>
  `;
}

function renderComingSoonPage(route: 'discovery' | 'flow'): string {
  const isFlow = route === 'flow';
  return `
    <section class="page coming-page">
      <div class="coming-card glass-panel">
        <span class="coming-icon">${icon(isFlow ? 'spark' : 'store', 34)}</span>
        <p class="eyebrow">${isFlow ? 'BUYFLOW AI' : 'FELFEDEZÉS'}</p>
        <h1>${isFlow ? 'Flow' : 'Felfedezés'}</h1>
        <p>${isFlow ? 'A régi Flow helyét már előkészítettük, de csak akkor kapcsoljuk vissza, amikor a V3 biztonságos AI-eszközeire tudjuk kötni.' : 'A régi Felfedezés felület visszatér, amikor már valódi V3 adatokkal tud működni.'}</p>
        <span class="soon-pill">Hamarosan</span>
      </div>
    </section>
  `;
}

function pageHtml(): string {
  switch (state.route) {
    case 'orders': return renderOrdersPage();
    case 'purchases': return renderPurchasesPage();
    case 'discovery': return renderComingSoonPage('discovery');
    case 'flow': return renderComingSoonPage('flow');
    default: return renderHomePage();
  }
}

function bottomNav(): string {
  const items: Array<[Route, string, string]> = [
    ['home', 'home', 'Kezdőlap'],
    ['orders', 'truck', 'Csomagok'],
    ['purchases', 'box', 'Vásárlások'],
    ['discovery', 'store', 'Felfedezés'],
    ['flow', 'spark', 'Flow'],
  ];
  return `<nav class="bottom-nav" aria-label="Fő navigáció">${items.map(([route, iconName, label]) => `
    <button class="nav-item ${state.route === route ? 'active' : ''}" type="button" data-route="${route}">
      ${icon(iconName, 21)}<span>${label}</span>
    </button>`).join('')}</nav>`;
}

function accountPanel(): string {
  if (!state.accountOpen) return '';
  const email = state.session?.user.email ?? '';
  return `
    <div class="account-popover glass-panel">
      <div class="account-popover-user"><span class="avatar">${icon('user', 18)}</span><div><strong>BuyFlow fiók</strong><small>${escapeHtml(email)}</small></div></div>
      <button id="logout-button" class="account-action" type="button">${icon('logout', 18)}<span>Kijelentkezés</span></button>
    </div>
  `;
}

function renderAppShell() {
  root.innerHTML = `
    ${ambientBackground()}
    <div class="app-shell">
      <header class="topbar">
        <button class="top-brand" type="button" data-route="home">
          <span class="mini-brand">${icon('spark', 20)}</span>
          <span><strong>BuyFlow</strong><small>Minden vásárlás a helyén</small></span>
        </button>
        <div class="top-actions">
          ${state.loading ? '<span class="sync-indicator">Frissítés…</span>' : ''}
          <button id="account-button" class="avatar-button" type="button" aria-label="Fiók">${icon('user', 19)}</button>
        </div>
        ${accountPanel()}
      </header>
      <main class="app-main">${pageHtml()}</main>
      ${bottomNav()}
    </div>
  `;
  bindAppHandlers();
}

function shipmentSection(purchase: PurchaseDetail): string {
  if (purchase.shipments.length === 0) return `<div class="detail-empty">Még nincs csomagkövetési adat.</div>`;

  return purchase.shipments.map((shipment) => {
    const trackingUrl = safeHttpUrl(shipment.trackingUrl);
    const tracking = shipment.trackingNumber
      ? `<code class="tracking-number">${escapeHtml(shipment.trackingNumber)}</code>`
      : '<span class="muted">Nincs tracking szám</span>';
    const link = trackingUrl
      ? `<a class="button secondary full-width" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">Futárkövetés megnyitása</a>`
      : '';
    return `
      <article class="detail-card">
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
  if (purchase.documents.length === 0) return `<div class="detail-empty">Még nincs számla vagy dokumentum.</div>`;

  return purchase.documents.map((document) => {
    const url = safeHttpUrl(document.externalUrl);
    const title = document.type === 'invoice' ? 'Számla' : document.type;
    const number = document.documentNumber || document.filename || 'Azonosító nélkül';
    return `
      <article class="document-row">
        <span class="document-icon">${icon('file', 20)}</span>
        <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(number)} · ${escapeHtml(formatDate(document.issuedAt || document.createdAt))}</small></div>
        ${url ? `<a class="document-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Megnyitás</a>` : '<span class="muted tiny">Adat elmentve</span>'}
      </article>
    `;
  }).join('');
}

function renderPurchaseDetail() {
  const purchase = state.selectedPurchase;
  if (!purchase) {
    renderAppShell();
    return;
  }

  const merchant = purchase.merchantName || purchase.merchantDomain || 'Ismeretlen webshop';
  root.innerHTML = `
    ${ambientBackground()}
    <div class="app-shell detail-shell">
      <header class="topbar detail-topbar">
        <button id="back-button" class="round-action" type="button" aria-label="Vissza">${icon('back', 20)}</button>
        <div class="detail-top-title"><small>RENDELÉS</small><strong>${escapeHtml(merchant)}</strong></div>
        <span class="topbar-spacer"></span>
      </header>
      <main class="app-main">
        <section class="page detail-page">
          ${feedbackHtml()}
          <article class="order-hero glass-panel">
            <div><p class="eyebrow">${purchase.orderNumber ? `#${escapeHtml(purchase.orderNumber)}` : 'RENDELÉSI SZÁM NÉLKÜL'}</p><h1>${escapeHtml(merchant)}</h1></div>
            <span class="badge badge-${cssToken(purchase.currentState)}">${escapeHtml(stateLabel(purchase.currentState))}</span>
            <div class="order-hero-meta"><strong>${formatMoney(purchase.totalAmount, purchase.currency)}</strong><span>${escapeHtml(formatDate(purchase.orderedAt || purchase.createdAt))}</span></div>
          </article>

          <div id="purchase-detail-enhancements"></div>

          <section class="content-section">
            <div class="section-head"><div><p class="eyebrow">RENDELÉS</p><h2>Részletek</h2></div></div>
            <div class="detail-card">
              <div class="detail-row"><span>Rendelési szám</span><strong>${escapeHtml(purchase.orderNumber || '—')}</strong></div>
              <div class="detail-row"><span>Fizetés</span><strong>${escapeHtml(purchase.paymentStatus ? stateLabel(purchase.paymentStatus) : '—')}</strong></div>
              <div class="detail-row"><span>Fizetési mód</span><strong>${escapeHtml(purchase.paymentMethod || '—')}</strong></div>
              <div class="detail-row"><span>Összeg</span><strong>${formatMoney(purchase.totalAmount, purchase.currency)}</strong></div>
            </div>
          </section>

          <section class="content-section">
            <div class="section-head"><div><p class="eyebrow">SZÁLLÍTÁS</p><h2>Csomagkövetés</h2></div></div>
            <div class="stack">${shipmentSection(purchase)}</div>
          </section>

          <section class="content-section">
            <div class="section-head"><div><p class="eyebrow">IRATTÁR</p><h2>Dokumentumok</h2></div></div>
            <div class="detail-card documents-card">${documentsSection(purchase)}</div>
          </section>
        </section>
      </main>
    </div>
  `;

  renderPurchaseDetailEnhancements(purchase);

  document.querySelector<HTMLButtonElement>('#back-button')?.addEventListener('click', () => {
    state.selectedPurchase = null;
    state.error = null;
    render();
  });
}

function bindAppHandlers() {
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      const route = button.dataset.route as Route | undefined;
      if (!route) return;
      state.route = route;
      state.accountOpen = false;
      state.error = null;
      state.notice = null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-purchase-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.purchaseId;
      if (id) void openPurchase(id);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-action="refresh"]').forEach((button) => {
    button.addEventListener('click', () => void refreshPurchases());
  });

  document.querySelector<HTMLButtonElement>('#account-button')?.addEventListener('click', () => {
    state.accountOpen = !state.accountOpen;
    render();
  });

  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', () => {
    void supabase.auth.signOut();
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
  renderAppShell();
}

async function handleLogin(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const formData = new FormData(form);
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    state.error = 'Add meg az email címedet és a jelszavadat.';
    state.notice = null;
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  state.notice = null;
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
  state.route = 'home';
  await refreshPurchases();
}

async function handleForgotPassword() {
  const email = document.querySelector<HTMLInputElement>('#email')?.value.trim() ?? '';
  if (!email) {
    state.error = 'Írd be előbb az email címedet.';
    state.notice = null;
    render();
    return;
  }

  state.loading = true;
  state.error = null;
  state.notice = null;
  render();

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_URL });
  state.loading = false;
  if (error) {
    state.error = 'A jelszó-visszaállító emailt most nem sikerült elküldeni.';
  } else {
    state.notice = 'Ha ez a fiók létezik, elküldtük a jelszó-visszaállító emailt.';
  }
  render();
}

async function refreshPurchases() {
  const session = state.session;
  if (!session) return;

  state.loading = true;
  state.error = null;
  state.notice = null;
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
    state.route = 'home';
    state.loading = false;
    state.accountOpen = false;
  }
  if (event === 'TOKEN_REFRESHED' && session) {
    // Future API calls use the refreshed token stored in state.
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
