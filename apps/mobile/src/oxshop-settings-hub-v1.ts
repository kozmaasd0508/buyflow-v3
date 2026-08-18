import { supabase } from './supabase.js';
import './oxshop-settings-hub-v1.css';

let handoffToLegacyPanel = false;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const icons = {
  user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  inbox: icon('<path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>'),
  shield: icon('<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  logout: icon('<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>'),
  back: icon('<path d="m15 18-6-6 6-6"/>'),
  chevron: icon('<path d="m9 18 6-6-6-6"/>'),
};

function closeSettingsHub() {
  document.querySelector('#bf-ox-settings-hub')?.remove();
  document.documentElement.classList.remove('bf-ox-settings-open');
}

async function handoffToAccountAction(actionId: string) {
  closeSettingsHub();
  document.documentElement.classList.add('bf-settings-handoff');
  handoffToLegacyPanel = true;
  try {
    document.querySelector<HTMLButtonElement>('.avatar-button')?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.querySelector<HTMLButtonElement>(`#${actionId}`)?.click();
  } finally {
    handoffToLegacyPanel = false;
    window.setTimeout(() => document.documentElement.classList.remove('bf-settings-handoff'), 80);
  }
}

function openInbox() {
  closeSettingsHub();
  const inbox = document.querySelector<HTMLButtonElement>('.bottom-nav [aria-label="Üzenetek"]');
  inbox?.click();
}

async function openSettingsHub() {
  closeSettingsHub();
  document.querySelector('.account-popover')?.remove();

  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const email = data.session.user.email ?? 'Bejelentkezett felhasználó';

  const root = document.createElement('section');
  root.id = 'bf-ox-settings-hub';
  root.className = 'bf-ox-settings-hub';
  root.setAttribute('aria-label', 'BuyFlow beállítások');
  root.innerHTML = `
    <header class="bf-ox-settings-head">
      <button type="button" class="bf-ox-settings-back" data-bf-settings-close aria-label="Vissza">${icons.back}</button>
      <h1>Beállítások</h1>
      <span class="bf-ox-settings-head-spacer"></span>
    </header>

    <main class="bf-ox-settings-content">
      <section class="bf-ox-settings-profile">
        <div class="bf-ox-settings-avatar">B</div>
        <div class="bf-ox-settings-profile-copy">
          <strong>BuyFlow fiók</strong>
          <span>${escapeHtml(email)}</span>
        </div>
      </section>

      <section class="bf-ox-settings-group">
        <p class="bf-ox-settings-label">FIÓK</p>
        <div class="bf-ox-settings-card">
          <button type="button" class="bf-ox-settings-row" data-open-profile>
            <span class="bf-ox-settings-icon">${icons.user}</span>
            <span class="bf-ox-settings-row-copy"><strong>Profil és BuyFlow email</strong><small>Saját @buyflow.hu címed és fiókadataid</small></span>
            <span class="bf-ox-settings-chevron">${icons.chevron}</span>
          </button>
        </div>
      </section>

      <section class="bf-ox-settings-group">
        <p class="bf-ox-settings-label">KAPCSOLATOK</p>
        <div class="bf-ox-settings-card">
          <button type="button" class="bf-ox-settings-row" data-open-email-settings>
            <span class="bf-ox-settings-icon">${icons.mail}</span>
            <span class="bf-ox-settings-row-copy"><strong>Email kapcsolat</strong><small>Gmail kapcsolat kezelése – opcionális</small></span>
            <span class="bf-ox-settings-chevron">${icons.chevron}</span>
          </button>
          <button type="button" class="bf-ox-settings-row" data-open-inbox>
            <span class="bf-ox-settings-icon">${icons.inbox}</span>
            <span class="bf-ox-settings-row-copy"><strong>Üzenetek</strong><small>Vásárlási értesítések és BuyFlow levelek</small></span>
            <span class="bf-ox-settings-chevron">${icons.chevron}</span>
          </button>
        </div>
      </section>

      <section class="bf-ox-settings-group">
        <p class="bf-ox-settings-label">ADATVÉDELEM</p>
        <div class="bf-ox-settings-card bf-ox-settings-static">
          <div class="bf-ox-settings-row">
            <span class="bf-ox-settings-icon">${icons.shield}</span>
            <span class="bf-ox-settings-row-copy"><strong>Biztonságos feldolgozás</strong><small>A BuyFlow bizonytalan esetben nem találgat, és a vásárlási leveleket ellenőrizhető szabályok szerint kezeli.</small></span>
          </div>
        </div>
      </section>

      <section class="bf-ox-settings-group bf-ox-settings-last">
        <div class="bf-ox-settings-card">
          <button type="button" class="bf-ox-settings-row bf-ox-settings-logout" data-logout>
            <span class="bf-ox-settings-icon">${icons.logout}</span>
            <span class="bf-ox-settings-row-copy"><strong>Kijelentkezés</strong><small>Kilépés ebből a BuyFlow fiókból</small></span>
          </button>
        </div>
      </section>
    </main>
  `;

  root.querySelectorAll<HTMLElement>('[data-bf-settings-close]').forEach((element) => {
    element.addEventListener('click', closeSettingsHub);
  });
  root.querySelector<HTMLButtonElement>('[data-open-profile]')?.addEventListener('click', () => {
    void handoffToAccountAction('shopping-profile-button');
  });
  root.querySelector<HTMLButtonElement>('[data-open-email-settings]')?.addEventListener('click', () => {
    void handoffToAccountAction('gmail-settings-button');
  });
  root.querySelector<HTMLButtonElement>('[data-open-inbox]')?.addEventListener('click', openInbox);
  root.querySelector<HTMLButtonElement>('[data-logout]')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    closeSettingsHub();
  });

  document.body.appendChild(root);
  document.documentElement.classList.add('bf-ox-settings-open');
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const avatar = target?.closest('.avatar-button');
  if (!avatar || handoffToLegacyPanel) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void openSettingsHub();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.querySelector('#bf-ox-settings-hub')) closeSettingsHub();
});
