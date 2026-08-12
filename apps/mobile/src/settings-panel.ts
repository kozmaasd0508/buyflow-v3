import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './settings-panel.css';

interface EmailConnection {
  id: string;
  provider: string;
  emailAddress: string;
  status: string;
  connectedAt: string;
  updatedAt: string;
}

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

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_REQUIRED');
  return token;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) throw new Error('SESSION_REQUIRED');
  if (!response.ok) throw new Error(`API_${response.status}`);
  return await response.json() as T;
}

async function loadConnections(): Promise<EmailConnection[]> {
  const data = await apiRequest<{ connections: EmailConnection[] }>('/api/email-connections');
  return data.connections;
}

async function startGmailConnection(): Promise<string> {
  const data = await apiRequest<{ authorizeUrl: string }>('/api/email-connections/nylas/start', {
    method: 'POST',
  });
  return data.authorizeUrl;
}

function closeSettings() {
  document.querySelector('#buyflow-settings-overlay')?.remove();
}

function settingsShell(email: string): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'buyflow-settings-overlay';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-backdrop" data-settings-close></div>
    <section class="settings-sheet" role="dialog" aria-modal="true" aria-label="BuyFlow beállítások">
      <header class="settings-header">
        <div>
          <p class="settings-eyebrow">BUYFLOW</p>
          <h1>Beállítások</h1>
        </div>
        <button class="settings-close" type="button" data-settings-close aria-label="Bezárás">×</button>
      </header>

      <div class="settings-content">
        <section class="settings-profile-card">
          <div class="settings-avatar">B</div>
          <div>
            <strong>BuyFlow fiók</strong>
            <span>${escapeHtml(email || 'Bejelentkezett felhasználó')}</span>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-section-title">
            <div>
              <p class="settings-eyebrow">E-MAIL AUTOMATIZÁLÁS</p>
              <h2>Gmail kapcsolat</h2>
            </div>
          </div>
          <div id="gmail-connection-content" class="gmail-connection-card">
            <div class="settings-spinner" aria-label="Betöltés"></div>
            <span>Kapcsolat ellenőrzése…</span>
          </div>
        </section>

        <section class="settings-info-card">
          <strong>Mit engedélyezel?</strong>
          <p>A Google engedélykérésén keresztül a BuyFlow a vásárlásokhoz kapcsolódó e-maileket tudja feldolgozni. A Google-jelszavadat a BuyFlow nem látja és nem tárolja.</p>
        </section>

        <button id="settings-logout" class="settings-logout" type="button">Kijelentkezés</button>
      </div>
    </section>
  `;

  overlay.querySelectorAll<HTMLElement>('[data-settings-close]').forEach((element) => {
    element.addEventListener('click', closeSettings);
  });

  overlay.querySelector<HTMLButtonElement>('#settings-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    closeSettings();
  });

  return overlay;
}

function renderConnectionCard(container: HTMLElement, connections: EmailConnection[]) {
  const active = connections.find((connection) => connection.provider === 'nylas' && connection.status === 'active');

  if (active) {
    container.classList.add('connected');
    container.innerHTML = `
      <div class="gmail-status-row">
        <span class="gmail-status-icon">✓</span>
        <div>
          <strong>Gmail csatlakoztatva</strong>
          <span>${escapeHtml(active.emailAddress)}</span>
        </div>
        <span class="gmail-status-pill">Aktív</span>
      </div>
      <div class="gmail-meta">
        <span>Kapcsolódás</span>
        <strong>${escapeHtml(formatDate(active.connectedAt))}</strong>
      </div>
      <p class="gmail-help">Az új vásárlási e-maileket a BuyFlow automatikusan fel tudja dolgozni.</p>
    `;
    return;
  }

  container.classList.remove('connected');
  container.innerHTML = `
    <div class="gmail-status-row">
      <span class="gmail-status-icon disconnected">G</span>
      <div>
        <strong>Nincs Gmail csatlakoztatva</strong>
        <span>Kapcsold össze a fiókodat a BuyFlow-val.</span>
      </div>
    </div>
    <button id="connect-gmail-button" class="connect-gmail-button" type="button">Gmail csatlakoztatása</button>
  `;

  container.querySelector<HTMLButtonElement>('#connect-gmail-button')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Google megnyitása…';

    try {
      const authorizeUrl = await startGmailConnection();
      window.location.assign(authorizeUrl);
    } catch {
      button.disabled = false;
      button.textContent = 'Gmail csatlakoztatása';
      const error = document.createElement('p');
      error.className = 'settings-error';
      error.textContent = 'Most nem sikerült elindítani a Gmail csatlakoztatását. Próbáld újra.';
      button.insertAdjacentElement('afterend', error);
    }
  });
}

async function openSettings(showResult?: 'connected' | 'error') {
  closeSettings();

  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  const overlay = settingsShell(data.session.user.email ?? '');
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  if (showResult === 'connected') {
    const notice = document.createElement('div');
    notice.className = 'settings-notice success';
    notice.textContent = 'Gmail sikeresen csatlakoztatva.';
    overlay.querySelector('.settings-content')?.prepend(notice);
  } else if (showResult === 'error') {
    const notice = document.createElement('div');
    notice.className = 'settings-notice error';
    notice.textContent = 'A Gmail csatlakoztatása nem sikerült. Próbáld újra.';
    overlay.querySelector('.settings-content')?.prepend(notice);
  }

  const container = overlay.querySelector<HTMLElement>('#gmail-connection-content');
  if (!container) return;

  try {
    renderConnectionCard(container, await loadConnections());
  } catch {
    container.innerHTML = '<p class="settings-error">A Gmail kapcsolat állapota most nem tölthető be.</p>';
  }
}

function enhanceAccountPopover() {
  const popover = document.querySelector('.account-popover');
  if (!popover || popover.querySelector('#open-settings-button')) return;

  const logout = popover.querySelector('#logout-button');
  const button = document.createElement('button');
  button.id = 'open-settings-button';
  button.className = 'account-action settings-account-action';
  button.type = 'button';
  button.innerHTML = '<span class="settings-gear">⚙</span><span>Beállítások</span>';
  button.addEventListener('click', () => void openSettings());

  if (logout) popover.insertBefore(button, logout);
  else popover.appendChild(button);
}

const observer = new MutationObserver(enhanceAccountPopover);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceAccountPopover();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettings();
});

const gmailResult = new URLSearchParams(window.location.search).get('gmail');
if (gmailResult === 'connected' || gmailResult === 'error') {
  history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  window.setTimeout(() => void openSettings(gmailResult), 350);
}
