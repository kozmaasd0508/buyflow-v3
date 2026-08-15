import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './gmail-settings-panel.css';

interface ScanResult {
  checked?: number;
  processed?: number;
  unlinked?: number;
  review?: number;
  ignored?: number;
  aiCalls?: number;
  purchaseWrites?: number;
  shipmentWrites?: number;
  documentWrites?: number;
}

interface InitialScan {
  windowDays: number;
  status: string;
  processedAt: string | null;
  result: ScanResult | null;
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

type ScanWindowDays = 7 | 30 | 90;

interface ApiErrorPayload {
  error?: string;
  stage?: string;
}

class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly stage: string | null;

  constructor(status: number, payload: ApiErrorPayload | null) {
    super(`API_${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = payload?.error ?? null;
    this.stage = payload?.stage ?? null;
  }
}

let oauthResult = new URLSearchParams(window.location.search).get('gmail');
let autoOpenedOauthResult = false;
let runningScan: { connectionId: string; windowDays: ScanWindowDays } | null = null;
let pollTimer: number | null = null;

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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

function scanClass(status: string | null | undefined): string {
  if (status === 'processed') return 'good';
  if (status === 'error') return 'bad';
  if (status === 'pending' || status === 'processing' || status === 'retry') return 'working';
  return 'neutral';
}

async function accessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    const token = data.session?.access_token;
    if (error || !token) throw new Error('SESSION_REQUIRED');
    return token;
  }

  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token) throw new Error('SESSION_REQUIRED');

  const expiresAt = session.expires_at ?? 0;
  const expiresSoon = expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 60;
  if (expiresSoon) return accessToken(true);
  return session.access_token;
}

async function fetchWithToken(path: string, init: RequestInit, token: string): Promise<Response> {
  return await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = await accessToken();
  let response = await fetchWithToken(path, init, token);

  if (response.status === 401) {
    token = await accessToken(true);
    response = await fetchWithToken(path, init, token);
  }

  if (response.status === 401) throw new Error('SESSION_REQUIRED');
  if (!response.ok) {
    let payload: ApiErrorPayload | null = null;
    try {
      payload = await response.json() as ApiErrorPayload;
    } catch {
      payload = null;
    }
    throw new ApiRequestError(response.status, payload);
  }
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

async function startScan(connectionId: string, windowDays: ScanWindowDays): Promise<void> {
  await request(`/api/email-connections/${encodeURIComponent(connectionId)}/initial-scan`, {
    method: 'POST',
    body: JSON.stringify({ windowDays }),
  });
}

function closeSettings() {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
  document.querySelector('#buyflow-gmail-settings-overlay')?.remove();
}

function oauthMessage(): string {
  if (oauthResult === 'connected') {
    return '<div class="gmail-settings-notice success"><strong>Gmail csatlakoztatva.</strong><span>A fiók megjelent az email kapcsolatok között, és az első ellenőrzés automatikusan elindult.</span></div>';
  }
  if (oauthResult === 'error') {
    return '<div class="gmail-settings-notice error"><strong>A Gmail csatlakoztatása nem sikerült.</strong><span>Próbáld újra; a meglévő BuyFlow adataid nem változtak.</span></div>';
  }
  return '';
}

function scanSummary(scan: InitialScan | null): string {
  if (!scan) return '<span class="gmail-scan-pill neutral">Még nincs ellenőrzés</span>';
  return `<span class="gmail-scan-pill ${scanClass(scan.status)}">${escapeHtml(scan.windowDays)} nap · ${escapeHtml(scanLabel(scan.status))}</span>`;
}

function scanResultHtml(scan: InitialScan | null): string {
  if (!scan?.result || scan.status !== 'processed') return '';
  const result = scan.result;
  return `
    <div class="gmail-scan-results">
      <div><strong>${numberValue(result.checked)}</strong><span>email ellenőrizve</span></div>
      <div><strong>${numberValue(result.processed)}</strong><span>feldolgozva</span></div>
      <div><strong>${numberValue(result.review)}</strong><span>review</span></div>
      <div><strong>${numberValue(result.unlinked)}</strong><span>kapcsolatlan</span></div>
      <div><strong>${numberValue(result.purchaseWrites)}</strong><span>új vásárlás</span></div>
      <div><strong>${numberValue(result.shipmentWrites)}</strong><span>csomag</span></div>
      <div><strong>${numberValue(result.documentWrites)}</strong><span>dokumentum</span></div>
      <div class="ai-zero"><strong>${numberValue(result.aiCalls)}</strong><span>AI hívás</span></div>
    </div>
    <div class="gmail-scan-finished">Utolsó teljes ellenőrzés: ${escapeHtml(formatDate(scan.processedAt))}</div>
  `;
}

function scanButtons(connection: EmailConnection): string {
  const activeWindow = runningScan?.connectionId === connection.id ? runningScan.windowDays : null;
  const working = Boolean(activeWindow);
  return `
    <div class="gmail-scan-actions">
      <div class="gmail-scan-actions-copy">
        <strong>Teljes inbox ellenőrzés</strong>
        <span>Nem kell webshopnevet vagy rendelési számot megadni. A BuyFlow a teljes biztonságos időablakot átnézi.</span>
      </div>
      <div class="gmail-scan-window-buttons">
        ${([7, 30, 90] as ScanWindowDays[]).map((windowDays) => `
          <button class="gmail-scan-window ${windowDays === 30 ? 'recommended' : ''}" type="button" data-scan-connection="${escapeHtml(connection.id)}" data-scan-window="${windowDays}" ${working ? 'disabled' : ''}>
            ${activeWindow === windowDays ? 'Dolgozik…' : `${windowDays} nap`}
          </button>
        `).join('')}
      </div>
      <small>A 30 nap az ajánlott vakteszt. A bizonytalan levelek REVIEW-ba kerülnek; az AI továbbra is ki van kapcsolva.</small>
    </div>
  `;
}

function connectionCard(connection: EmailConnection): string {
  return `
    <article class="gmail-account-card" data-email-connection-id="${escapeHtml(connection.id)}">
      <div class="gmail-connection-card">
        <div class="gmail-connection-icon">G</div>
        <div class="gmail-connection-main">
          <div class="gmail-connection-title"><strong>Gmail aktív</strong><span class="gmail-live-dot"></span></div>
          <span>${escapeHtml(connection.emailAddress || 'Google fiók')}</span>
          <small>Csatlakoztatva: ${escapeHtml(formatDate(connection.connectedAt))}</small>
        </div>
        ${scanSummary(connection.initialScan)}
      </div>
      ${scanButtons(connection)}
      ${scanResultHtml(connection.initialScan)}
    </article>
  `;
}

function connectedHtml(connections: EmailConnection[]): string {
  return `
    <div id="gmail-connection-content" class="gmail-connection-content connected">
      <div class="gmail-settings-toolbar">
        <div><strong>${connections.length} aktív Gmail-fiók</strong><span>Minden fiók külön ellenőrizhető.</span></div>
        <button id="gmail-add-account-button" class="gmail-secondary-button" type="button">+ Másik Gmail hozzáadása</button>
      </div>
      <div class="gmail-accounts-list">${connections.map(connectionCard).join('')}</div>
      <div class="gmail-settings-explainer">
        <strong>Mit csinál a BuyFlow?</strong>
        <p>A rendelés-visszaigazolásokat, számlákat és futárértesítőket egyetlen vásárlási életúttá rendezi. A teljes inbox scan nem a Gmail Purchases kategóriájára támaszkodik; bizonytalan esetben nem találgat.</p>
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
        <small>A Google belépés a Nylas OAuth folyamatán keresztül történik.</small>
      </div>
    </div>
  `;
}

function oauthErrorDetail(error: unknown): { title: string; detail: string } {
  if (error instanceof Error && error.message === 'SESSION_REQUIRED') {
    return {
      title: 'A BuyFlow bejelentkezésedet frissíteni kell.',
      detail: 'Jelentkezz ki, majd vissza, és utána próbáld újra a Gmail hozzáadását.',
    };
  }

  if (error instanceof ApiRequestError) {
    const stageLabels: Record<string, string> = {
      ensure_user: 'felhasználói kapcsolat',
      application_id: 'Nylas alkalmazáskapcsolat',
      oauth_state: 'biztonsági OAuth állapot',
      authorize_url: 'Google átirányítás előkészítése',
    };
    const stage = error.stage ? (stageLabels[error.stage] ?? error.stage) : null;
    const detail = stage
      ? `Szerverhiba: ${error.status}. Hibapont: ${stage}.`
      : `Szerverhiba: ${error.status}${error.code ? ` · ${error.code}` : ''}.`;
    return {
      title: 'A Gmail csatlakozás indítása nem sikerült.',
      detail,
    };
  }

  return {
    title: 'A Gmail csatlakozás indítása nem sikerült.',
    detail: 'Hálózati vagy böngészőkapcsolati hiba történt. Frissítsd az oldalt, majd próbáld újra.',
  };
}

async function beginOauth(button: HTMLButtonElement) {
  button.disabled = true;
  const original = button.textContent ?? 'Gmail csatlakoztatása';
  button.textContent = 'Google megnyitása…';
  document.querySelector('[data-gmail-oauth-error]')?.remove();
  try {
    const authorizeUrl = await startGmailConnection();
    window.location.assign(authorizeUrl);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    const body = document.querySelector<HTMLElement>('#gmail-settings-body');
    const message = oauthErrorDetail(error);
    if (body) {
      body.insertAdjacentHTML(
        'afterbegin',
        `<div class="gmail-settings-notice error" data-gmail-oauth-error><strong>${escapeHtml(message.title)}</strong><span>${escapeHtml(message.detail)}</span></div>`,
      );
    }
  }
}

function bindBodyActions() {
  document.querySelector<HTMLButtonElement>('#gmail-connect-button')?.addEventListener('click', (event) => {
    void beginOauth(event.currentTarget as HTMLButtonElement);
  });
  document.querySelector<HTMLButtonElement>('#gmail-add-account-button')?.addEventListener('click', (event) => {
    void beginOauth(event.currentTarget as HTMLButtonElement);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-scan-connection][data-scan-window]').forEach((button) => {
    button.addEventListener('click', () => {
      const connectionId = button.dataset.scanConnection;
      const windowDays = Number(button.dataset.scanWindow) as ScanWindowDays;
      if (!connectionId || ![7, 30, 90].includes(windowDays)) return;
      button.disabled = true;
      button.textContent = 'Indítás…';
      void runFullScan(connectionId, windowDays);
    });
  });
}

function schedulePoll() {
  if (!runningScan || pollTimer !== null || !document.querySelector('#gmail-settings-body')) return;
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void renderSettingsBody();
  }, 3000);
}

async function runFullScan(connectionId: string, windowDays: ScanWindowDays) {
  runningScan = { connectionId, windowDays };
  try {
    await startScan(connectionId, windowDays);
    await renderSettingsBody();
    if (runningScan) schedulePoll();
  } catch {
    runningScan = null;
    await renderSettingsBody();
    const body = document.querySelector<HTMLElement>('#gmail-settings-body');
    if (body) body.insertAdjacentHTML('afterbegin', `<div class="gmail-settings-notice error"><strong>A ${windowDays} napos ellenőrzés nem indult el.</strong><span>Próbáld újra később.</span></div>`);
  }
}

async function renderSettingsBody() {
  const body = document.querySelector<HTMLElement>('#gmail-settings-body');
  if (!body) return;
  body.innerHTML = '<div class="gmail-settings-loading"><div class="spinner small"></div><span>Email kapcsolatok betöltése…</span></div>';

  try {
    const connections = await loadConnections();
    const active = connections.filter((connection) => connection.provider === 'nylas' && connection.status === 'active');

    if (runningScan) {
      const current = active.find((connection) => connection.id === runningScan?.connectionId);
      const scan = current?.initialScan;
      if (
        scan &&
        scan.windowDays === runningScan.windowDays &&
        (scan.status === 'processed' || scan.status === 'error')
      ) {
        runningScan = null;
      }
    }

    body.innerHTML = `${oauthMessage()}${active.length > 0 ? connectedHtml(active) : disconnectedHtml()}`;
    bindBodyActions();
    if (runningScan) schedulePoll();
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
