import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './gmail-settings-panel.css';

interface InitialScan {
  windowDays: number;
  status: string;
  processedAt: string | null;
  result: Record<string, unknown> | null;
}

interface EmailConnection {
  id: string;
  provider: string;
  emailAddress: string | null;
  status: string;
  connectedAt: string | null;
  updatedAt: string | null;
  initialScan: InitialScan | null;
}

let oauthResult = new URLSearchParams(window.location.search).get('gmail');
let autoOpenedOauthResult = false;

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
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function scanLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    pending: 'Indításra vár',
    processing: 'Feldolgozás alatt',
    retry: 'Újrapróbálás',
    processed: 'Kész',
    error: 'Hiba',
  };
  return labels[status ?? ''] ?? (status ? status.replaceAll('_', ' ') : 'Még nem indult');
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_REQUIRED');
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 401) throw new Error('SESSION_REQUIRED');
  if (!response.ok) throw new Error(`API_${response.status}`);
  return await response.json() as T;
}

async function loadConnections(): Promise<EmailConnection[]> {
  const data = await request<{ connections: EmailConnection[] }>('/api/email-connections');
  return data.connections;
}

async function startGmailConnection(): Promise<string> {
  const data = await request<{ authorizeUrl: string }>('/api/email-connections/nylas/start', { method: 'POST' });
  return data.authorizeUrl;
}

function closeSettings() {
  document.querySelector('#buyflow-gmail-settings-overlay')?.remove();
}

function oauthMessage(): string {
  if (oauthResult === 'connected') {
    return '<div class="gmail-settings-notice success"><strong>Gmail csatlakoztatva.</strong><span>A BuyFlow már fogadhatja és feldolgozhatja a vásárlási emaileket.</span></div>';
  }
  if (oauthResult === 'error') {
    return '<div class="gmail-settings-notice error"><strong>A Gmail csatlakoztatása nem sikerült.</strong><span>Próbáld újra; a meglévő BuyFlow adataid nem változtak.</span></div>';
  }
  return '';
}

function scanSummary(connection: EmailConnection): string {
  const scan = connection.initialScan;
  if (!scan) return '<span class="gmail-scan-pill neutral">Még nincs első ellenőrzés</span>';
  const cls = scan.status === 'processed' ? 'good' : scan.status === 'error' ? 'bad' : 'working';
  return `<span class="gmail-scan-pill ${cls}">${escapeHtml(scan.windowDays)} nap · ${escapeHtml(scanLabel(scan.status))}</span>`;
}

function connectedHtml(connection: EmailConnection): string {
  return `
    <div id="gmail-connection-content" class="gmail-connection-content connected">
      <div class="gmail-connection-card">
        <div class="gmail-connection-icon">G</div>
        <div class="gmail-connection-main">
          <div class="gmail-connection-title"><strong>Gmail aktív</strong><span class="gmail-live-dot"></span></div>
          <span>${escapeHtml(connection.emailAddress || 'Google fiók')}</span>
          <small>Csatlakoztatva: ${escapeHtml(formatDate(connection.connectedAt))}</small>
        </div>
        ${scanSummary(connection)}
      </div>
      <div class="gmail-settings-explainer">
        <strong>Mit csinál a BuyFlow?</strong>
        <p>A rendelés-visszaigazolásokat, számlákat és futárértesítőket egyetlen vásárlási életúttá rendezi. Bizonytalan esetben nem hoz létre automatikusan új rendelést.</p>
      </div>
    </div>
  `;
}

function disconnectedHtml(): string {
  return `
    <div id="gmail-connection-content" class="gmail-connection-content disconnected">
      <div class="gmail-empty-state">
        <div class="gmail-connection-icon">G</div>
        <h3>Csatlakoztasd a Gmail-fiókodat</h3>
        <p>Így a BuyFlow automatikusan felismerheti a rendeléseket, számlákat és csomagértesítőket.</p>
        <button id="gmail-connect-button" class="gmail-primary-button" type="button">Gmail csatlakoztatása</button>
        <small>A Google belépés a Nylas biztonságos OAuth folyamatán keresztül történik.</small>
      </div>
    </div>
  `;
}

async function renderSettingsBody() {
  const body = document.querySelector<HTMLElement>('#gmail-settings-body');
  if (!body) return;
  body.innerHTML = '<div class="gmail-settings-loading"><div class="spinner small"></div><span>Email kapcsolat betöltése…</span></div>';

  try {
    const connections = await loadConnections();
    const active = connections.find((connection) => connection.provider === 'nylas' && connection.status === 'active') ?? null;
    body.innerHTML = `${oauthMessage()}${active ? connectedHtml(active) : disconnectedHtml()}`;

    body.querySelector<HTMLButtonElement>('#gmail-connect-button')?.addEventListener('click', (event) => {
      void (async () => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.textContent = 'Google megnyitása…';
        try {
          const authorizeUrl = await startGmailConnection();
          window.location.assign(authorizeUrl);
        } catch {
          button.disabled = false;
          button.textContent = 'Gmail csatlakoztatása';
          const error = document.createElement('div');
          error.className = 'gmail-settings-notice error';
          error.innerHTML = '<strong>Most nem sikerült elindítani a csatlakozást.</strong><span>Próbáld újra később.</span>';
          body.prepend(error);
        }
      })();
    });
  } catch {
    body.innerHTML = '<div class="gmail-settings-notice error"><strong>Az email kapcsolat most nem tölthető be.</strong><span>A vásárlási adataid ettől nem vesznek el.</span></div>';
  }
}

function openSettings() {
  closeSettings();
  const overlay = document.createElement('div');
  overlay.id = 'buyflow-gmail-settings-overlay';
  overlay.className = 'gmail-settings-overlay';
  overlay.innerHTML = `
    <div class="gmail-settings-backdrop" data-gmail-close></div>
    <section class="gmail-settings-sheet" role="dialog" aria-modal="true" aria-label="Email és Gmail beállítások">
      <header class="gmail-settings-header">
        <div><p>BUYFLOW EMAIL</p><h2>Gmail és feldolgozás</h2></div>
        <button class="gmail-settings-close" type="button" data-gmail-close aria-label="Bezárás">×</button>
      </header>
      <div id="gmail-settings-body"></div>
    </section>
  `;
  overlay.querySelectorAll<HTMLElement>('[data-gmail-close]').forEach((element) => element.addEventListener('click', closeSettings));
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  void renderSettingsBody();
}

function enhanceAccountPanel() {
  const popover = document.querySelector<HTMLElement>('.account-popover');
  if (!popover || popover.dataset.gmailEnhanced === '1') return;
  popover.dataset.gmailEnhanced = '1';
  const logout = popover.querySelector('#logout-button');
  const button = document.createElement('button');
  button.id = 'gmail-settings-button';
  button.className = 'account-action';
  button.type = 'button';
  button.innerHTML = '<span class="gmail-account-icon">G</span><span>Email és Gmail</span>';
  button.addEventListener('click', openSettings);
  if (logout) popover.insertBefore(button, logout);
  else popover.appendChild(button);
}

function maybeOpenOauthResult() {
  if (autoOpenedOauthResult || !oauthResult) return;
  if (!document.querySelector('.app-shell')) return;
  autoOpenedOauthResult = true;
  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
  history.replaceState(null, '', cleanUrl);
  openSettings();
  window.setTimeout(() => { oauthResult = null; }, 1000);
}

const observer = new MutationObserver(() => {
  enhanceAccountPanel();
  maybeOpenOauthResult();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceAccountPanel();
maybeOpenOauthResult();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettings();
});
