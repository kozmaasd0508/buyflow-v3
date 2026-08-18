import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './shopping-email-profile.css';

interface ShoppingEmailAssigned {
  assigned: true;
  emailAddress: string;
  localPart: string;
  status: string;
  changeable: false;
}

interface ShoppingEmailUnassigned {
  assigned: false;
  emailAddress: null;
  localPart: null;
  suggestedLocalPart: string;
  suggestedEmailAddress: string;
  changeable: true;
}

type ShoppingEmailState = ShoppingEmailAssigned | ShoppingEmailUnassigned;

interface AvailabilityResponse {
  localPart: string;
  emailAddress: string;
  available: boolean;
  ownedByYou: boolean;
  canChoose: boolean;
}

interface ApiErrorPayload {
  error?: string;
}

class ShoppingEmailApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, payload: ApiErrorPayload | null) {
    super(`API_${status}`);
    this.name = 'ShoppingEmailApiError';
    this.status = status;
    this.code = payload?.error ?? null;
  }
}

let availabilityTimer: number | null = null;
let availabilitySequence = 0;
let chosenAvailable = false;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
    throw new ShoppingEmailApiError(response.status, payload);
  }
  return await response.json() as T;
}

async function loadShoppingEmail(): Promise<ShoppingEmailState> {
  return await request<ShoppingEmailState>('/api/shopping-email');
}

async function checkAvailability(localPart: string): Promise<AvailabilityResponse> {
  return await request<AvailabilityResponse>(
    `/api/shopping-email/availability?localPart=${encodeURIComponent(localPart)}`,
  );
}

async function assignShoppingEmail(localPart: string): Promise<ShoppingEmailAssigned> {
  return await request<ShoppingEmailAssigned>('/api/shopping-email', {
    method: 'POST',
    body: JSON.stringify({ localPart }),
  });
}

function closeProfile() {
  if (availabilityTimer !== null) {
    window.clearTimeout(availabilityTimer);
    availabilityTimer = null;
  }
  availabilitySequence += 1;
  document.querySelector('#buyflow-shopping-profile-overlay')?.remove();
}

function statusMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'SESSION_REQUIRED') {
    return 'A bejelentkezésed lejárt. Jelentkezz be újra.';
  }
  if (error instanceof ShoppingEmailApiError) {
    if (error.code === 'shopping_email_name_taken') return 'Ez a BuyFlow email név már foglalt.';
    if (error.code === 'invalid_shopping_email_name') return 'Ez a név nem használható. Használj legalább 3 karaktert, ékezet nélkül.';
    if (error.code === 'shopping_email_already_assigned') return 'Ehhez a fiókhoz már tartozik BuyFlow email cím.';
  }
  return 'A BuyFlow email most nem tölthető be. Próbáld újra később.';
}

function assignedCard(data: ShoppingEmailAssigned): string {
  return `
    <section class="shopping-email-card assigned">
      <div class="shopping-email-card-head">
        <div>
          <p>SAJÁT VÁSÁRLÁSI EMAIL</p>
          <h3>A BuyFlow címed</h3>
        </div>
        <span class="shopping-email-live"><i></i> Aktív</span>
      </div>
      <div class="shopping-email-address-display">
        <strong>${escapeHtml(data.emailAddress)}</strong>
        <button id="shopping-email-copy" type="button">Másolás</button>
      </div>
      <p class="shopping-email-help">Ezt az email címet add meg webshopos vásárláskor. A rendelési, csomag-, számla- és visszaküldési levelek később közvetlenül a BuyFlowba érkezhetnek.</p>
      <div class="shopping-email-lock-note"><span>✓</span><p><strong>Ez a címed mostantól állandó.</strong><small>Így a webshopok későbbi értesítései mindig ugyanahhoz a BuyFlow fiókhoz érkeznek.</small></p></div>
    </section>
  `;
}

function unassignedCard(data: ShoppingEmailUnassigned): string {
  return `
    <section class="shopping-email-card chooser">
      <div class="shopping-email-card-head">
        <div>
          <p>SAJÁT VÁSÁRLÁSI EMAIL</p>
          <h3>Válaszd ki a címed</h3>
        </div>
        <span class="shopping-email-new">Új</span>
      </div>
      <p class="shopping-email-help">A BuyFlow a fiókod email címe alapján ajánlott egy könnyen megjegyezhető nevet. Még átírhatod, mielőtt véglegesíted.</p>
      <label class="shopping-email-label" for="shopping-email-local-part">BuyFlow email neved</label>
      <div class="shopping-email-input-row">
        <input id="shopping-email-local-part" type="text" inputmode="email" autocomplete="off" spellcheck="false" maxlength="40" value="${escapeHtml(data.suggestedLocalPart)}" aria-describedby="shopping-email-availability" />
        <span>@buyflow.hu</span>
      </div>
      <div id="shopping-email-availability" class="shopping-email-availability checking">Ellenőrzés…</div>
      <small class="shopping-email-rules">3–40 karakter · betű, szám, pont, kötőjel vagy aláhúzás · ékezet nélkül</small>
      <button id="shopping-email-create" class="shopping-email-primary" type="button" disabled>Cím létrehozása</button>
      <div class="shopping-email-once"><span>i</span><p>A létrehozás után ezt a címet nem változtatjuk meg automatikusan, mert a webshopok ehhez küldik majd a későbbi értesítéseket.</p></div>
    </section>
  `;
}

async function copyAddress(address: string) {
  try {
    await navigator.clipboard.writeText(address);
  } catch {
    const input = document.createElement('input');
    input.value = address;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  const button = document.querySelector<HTMLButtonElement>('#shopping-email-copy');
  if (!button) return;
  button.textContent = 'Kimásolva ✓';
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = 'Másolás';
  }, 1800);
}

function setAvailabilityState(kind: 'checking' | 'available' | 'taken' | 'invalid' | 'error', text: string) {
  const element = document.querySelector<HTMLElement>('#shopping-email-availability');
  const createButton = document.querySelector<HTMLButtonElement>('#shopping-email-create');
  if (element) {
    element.className = `shopping-email-availability ${kind}`;
    element.textContent = text;
  }
  chosenAvailable = kind === 'available';
  if (createButton) createButton.disabled = !chosenAvailable;
}

function localPartLooksValid(value: string): boolean {
  const localPart = value.trim().toLowerCase();
  if (localPart.length < 3 || localPart.length > 40) return false;
  if (!/^[a-z0-9._-]+$/.test(localPart)) return false;
  if (!/^[a-z0-9]/.test(localPart) || !/[a-z0-9]$/.test(localPart)) return false;
  if (/[._-]{2}/.test(localPart)) return false;
  return true;
}

function scheduleAvailabilityCheck(value: string, immediate = false) {
  if (availabilityTimer !== null) window.clearTimeout(availabilityTimer);
  const localPart = value.trim().toLowerCase();
  if (!localPartLooksValid(localPart)) {
    setAvailabilityState('invalid', 'Adj meg egy használható nevet.');
    return;
  }

  setAvailabilityState('checking', 'Ellenőrzés…');
  const sequence = ++availabilitySequence;
  availabilityTimer = window.setTimeout(() => {
    availabilityTimer = null;
    void (async () => {
      try {
        const result = await checkAvailability(localPart);
        if (sequence !== availabilitySequence || !document.querySelector('#buyflow-shopping-profile-overlay')) return;
        if (result.available && result.canChoose) {
          setAvailabilityState('available', `Szabad: ${result.emailAddress}`);
        } else {
          setAvailabilityState('taken', 'Ez a név már foglalt. Próbálj másikat.');
        }
      } catch (error) {
        if (sequence !== availabilitySequence) return;
        if (error instanceof ShoppingEmailApiError && error.code === 'invalid_shopping_email_name') {
          setAvailabilityState('invalid', 'Ez a név nem használható.');
        } else {
          setAvailabilityState('error', 'A foglaltság most nem ellenőrizhető.');
        }
      }
    })();
  }, immediate ? 0 : 350);
}

function bindShoppingEmailActions(data: ShoppingEmailState) {
  if (data.assigned) {
    document.querySelector<HTMLButtonElement>('#shopping-email-copy')?.addEventListener('click', () => {
      void copyAddress(data.emailAddress);
    });
    return;
  }

  const input = document.querySelector<HTMLInputElement>('#shopping-email-local-part');
  const createButton = document.querySelector<HTMLButtonElement>('#shopping-email-create');
  if (!input || !createButton) return;

  input.addEventListener('input', () => {
    input.value = input.value.toLowerCase();
    scheduleAvailabilityCheck(input.value);
  });

  createButton.addEventListener('click', () => {
    if (!chosenAvailable) return;
    void createShoppingEmail(input, createButton);
  });

  scheduleAvailabilityCheck(input.value, true);
}

async function createShoppingEmail(input: HTMLInputElement, button: HTMLButtonElement) {
  const localPart = input.value.trim().toLowerCase();
  if (!chosenAvailable || !localPartLooksValid(localPart)) return;

  button.disabled = true;
  button.textContent = 'Létrehozás…';
  try {
    const assigned = await assignShoppingEmail(localPart);
    const body = document.querySelector<HTMLElement>('#shopping-profile-body');
    if (!body) return;
    body.innerHTML = `${profileIdentityHtml()}${assignedCard(assigned)}${privacyNoteHtml()}`;
    bindShoppingEmailActions(assigned);
  } catch (error) {
    button.textContent = 'Cím létrehozása';
    setAvailabilityState(
      error instanceof ShoppingEmailApiError && error.code === 'shopping_email_name_taken' ? 'taken' : 'error',
      statusMessage(error),
    );
  }
}

function profileIdentityHtml(): string {
  const email = document.querySelector('.account-popover-user small')?.textContent?.trim() ?? '';
  return `
    <section class="shopping-profile-identity">
      <div class="shopping-profile-avatar">B</div>
      <div><p>BUYFLOW FIÓK</p><strong>${escapeHtml(email || 'Bejelentkezett felhasználó')}</strong><span>A fiók email címe a belépéshez tartozik.</span></div>
    </section>
  `;
}

function privacyNoteHtml(): string {
  return `
    <section class="shopping-profile-privacy">
      <span class="shopping-profile-shield">✓</span>
      <div><strong>A Gmail-edet nem kell olvasnunk.</strong><p>A saját <b>@buyflow.hu</b> címed lesz a webshopos levelek külön bejárata. A Google/Gmail cím csak a BuyFlow fiókodhoz tartozhat.</p></div>
    </section>
  `;
}

async function renderProfileBody() {
  const body = document.querySelector<HTMLElement>('#shopping-profile-body');
  if (!body) return;
  body.innerHTML = '<div class="shopping-profile-loading"><div class="spinner small"></div><span>Profil betöltése…</span></div>';

  try {
    const data = await loadShoppingEmail();
    if (!body.isConnected) return;
    body.innerHTML = `${profileIdentityHtml()}${data.assigned ? assignedCard(data) : unassignedCard(data)}${privacyNoteHtml()}`;
    bindShoppingEmailActions(data);
  } catch (error) {
    body.innerHTML = `
      ${profileIdentityHtml()}
      <div class="shopping-profile-error"><strong>A BuyFlow email most nem tölthető be.</strong><span>${escapeHtml(statusMessage(error))}</span><button id="shopping-profile-retry" type="button">Újrapróbálás</button></div>
      ${privacyNoteHtml()}
    `;
    document.querySelector<HTMLButtonElement>('#shopping-profile-retry')?.addEventListener('click', () => void renderProfileBody());
  }
}

function openProfile() {
  closeProfile();
  const overlay = document.createElement('div');
  overlay.id = 'buyflow-shopping-profile-overlay';
  overlay.className = 'shopping-profile-overlay';
  overlay.innerHTML = `
    <div class="shopping-profile-backdrop" data-shopping-profile-close></div>
    <section class="shopping-profile-sheet" role="dialog" aria-modal="true" aria-label="BuyFlow profil és saját email">
      <header class="shopping-profile-header">
        <div><p>SAJÁT BUYFLOW</p><h2>Profil</h2></div>
        <button type="button" data-shopping-profile-close aria-label="Bezárás">×</button>
      </header>
      <div id="shopping-profile-body"></div>
    </section>
  `;
  overlay.querySelectorAll<HTMLElement>('[data-shopping-profile-close]').forEach((element) => {
    element.addEventListener('click', closeProfile);
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  void renderProfileBody();
}

function enhanceAccountPanel() {
  const popover = document.querySelector<HTMLElement>('.account-popover');
  if (!popover || popover.dataset.shoppingProfileEnhanced === '1') return;
  popover.dataset.shoppingProfileEnhanced = '1';

  const gmailButton = popover.querySelector('#gmail-settings-button');
  const logout = popover.querySelector('#logout-button');
  const button = document.createElement('button');
  button.id = 'shopping-profile-button';
  button.className = 'account-action';
  button.type = 'button';
  button.innerHTML = '<span class="shopping-profile-account-icon">@</span><span>Profil és BuyFlow email</span>';
  button.addEventListener('click', openProfile);

  if (gmailButton) popover.insertBefore(button, gmailButton);
  else if (logout) popover.insertBefore(button, logout);
  else popover.appendChild(button);
}

const observer = new MutationObserver(enhanceAccountPanel);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceAccountPanel();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeProfile();
});
