import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './purchase-recovery-panel.css';

type WindowDays = 7 | 30 | 90;

interface RecoveryResult {
  checked: number;
  processed: number;
  unlinked: number;
  review: number;
  ignored: number;
  purchaseWrites: number;
  shipmentWrites: number;
  documentWrites: number;
}

interface RecoveryJob {
  id: string;
  windowDays: number;
  status: string;
  processedAt: string | null;
  retrying: boolean;
  failed: boolean;
  result: RecoveryResult | null;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_REQUIRED');
  return token;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (response.status === 409) throw new Error('EMAIL_CONNECTION_REQUIRED');
  if (!response.ok) throw new Error(`API_${response.status}`);
  return await response.json() as T;
}

async function startRecovery(searchTerm: string, windowDays: WindowDays): Promise<string> {
  const data = await requestJson<{ jobId: string }>('/api/purchase-recovery', {
    method: 'POST',
    body: JSON.stringify({ searchTerm, windowDays }),
  });
  return data.jobId;
}

async function loadRecovery(jobId: string): Promise<RecoveryJob> {
  const data = await requestJson<{ job: RecoveryJob }>(
    `/api/purchase-recovery/${encodeURIComponent(jobId)}`,
  );
  return data.job;
}

function closeRecovery() {
  document.querySelector('#buyflow-recovery-overlay')?.remove();
}

function resultContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#recovery-result');
}

function renderProgress(message: string) {
  const container = resultContainer();
  if (!container) return;
  container.className = 'recovery-result';
  container.innerHTML = `
    <div class="recovery-progress">
      <span class="recovery-progress-dot"></span>
      <strong>${message}</strong>
    </div>
    <p>A keresés a háttérben is folytatódik. Bezárhatod ezt az ablakot.</p>
  `;
}

function renderFailure(message: string) {
  const container = resultContainer();
  if (!container) return;
  container.className = 'recovery-result error';
  container.innerHTML = `<strong>Most nem sikerült</strong><p>${message}</p>`;
}

function renderCompleted(result: RecoveryResult | null) {
  const container = resultContainer();
  if (!container) return;
  const safe = result ?? {
    checked: 0,
    processed: 0,
    unlinked: 0,
    review: 0,
    ignored: 0,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
  };

  if (safe.purchaseWrites > 0) {
    container.className = 'recovery-result success';
    container.innerHTML = `
      <strong>Megtaláltuk a hiányzó vásárlást.</strong>
      <p>${safe.purchaseWrites} új, biztonságosan azonosított vásárlás került be. A keresés ${safe.checked} emailt ellenőrzött.</p>
      <button id="recovery-refresh-purchases" class="recovery-refresh-button" type="button">Vásárlások frissítése</button>
    `;
    container.querySelector<HTMLButtonElement>('#recovery-refresh-purchases')?.addEventListener('click', () => {
      window.location.reload();
    });
    return;
  }

  container.className = 'recovery-result';
  if (safe.checked === 0) {
    container.innerHTML = `
      <strong>Nem találtunk egyező emailt.</strong>
      <p>Próbáld meg a webshop nevét vagy a rendelési számot másképp megadni, esetleg válassz hosszabb időszakot.</p>
    `;
    return;
  }

  if (safe.processed > 0) {
    container.className = 'recovery-result success';
    container.innerHTML = `
      <strong>Ezt a vásárlást már ismeri a BuyFlow.</strong>
      <p>${safe.checked} emailt ellenőriztünk, ebből ${safe.processed} már egy meglévő vásárláshoz kapcsolódik. Nem hoztunk létre másolatot.</p>
      <button id="recovery-refresh-purchases" class="recovery-refresh-button" type="button">Vásárlások megtekintése</button>
    `;
    container.querySelector<HTMLButtonElement>('#recovery-refresh-purchases')?.addEventListener('click', () => {
      closeRecovery();
    });
    return;
  }

  if (safe.unlinked > 0) {
    container.innerHTML = `
      <strong>Találtunk kapcsolódó emaileket.</strong>
      <p>${safe.checked} emailt ellenőriztünk. ${safe.unlinked} levelet felismertünk, de még nincs elég biztos adat egy új vásárlás létrehozásához.</p>
    `;
    return;
  }

  if (safe.review > 0) {
    container.innerHTML = `
      <strong>Találtunk bizonytalan egyezést.</strong>
      <p>${safe.checked} emailt ellenőriztünk, de a BuyFlow nem kapott elég biztos bizonyítékot ahhoz, hogy automatikusan új vásárlást hozzon létre.</p>
    `;
    return;
  }

  container.innerHTML = `
    <strong>Nem találtunk új vásárlást.</strong>
    <p>${safe.checked} emailt ellenőriztünk, de egyikből sem azonosítható biztonságosan új rendelés.</p>
  `;
}

async function pollRecovery(jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1500 : 2500));
    const job = await loadRecovery(jobId);
    if (job.status === 'processed') {
      renderCompleted(job.result);
      return;
    }
    if (job.status === 'retry') {
      renderProgress('Újrapróbáljuk a keresést…');
    } else {
      renderProgress('Keresés folyamatban…');
    }
  }

  renderProgress('A keresés még dolgozik…');
}

function openRecovery() {
  closeRecovery();
  const overlay = document.createElement('div');
  overlay.id = 'buyflow-recovery-overlay';
  overlay.className = 'recovery-overlay';
  overlay.innerHTML = `
    <div class="recovery-backdrop" data-recovery-close></div>
    <section class="recovery-sheet" role="dialog" aria-modal="true" aria-label="Hiányzó vásárlás keresése">
      <header class="recovery-header">
        <div>
          <p>BUYFLOW RECOVERY</p>
          <h2>Hiányzik egy vásárlásod?</h2>
        </div>
        <button class="recovery-close" type="button" data-recovery-close aria-label="Bezárás">×</button>
      </header>

      <p class="recovery-copy">Írd be a webshop nevét vagy a rendelési számot. A BuyFlow célzottan keres, ezért nem kell újra az egész Gmail-fiókot átnéznie.</p>

      <form id="recovery-form" class="recovery-form">
        <label class="recovery-label">
          <span>Webshop vagy rendelési szám</span>
          <input id="recovery-search-term" class="recovery-input" type="text" minlength="2" maxlength="120" autocomplete="off" placeholder="pl. GymBeam vagy 12345678" required />
        </label>

        <div>
          <div class="recovery-window-title">Milyen régen vásároltál?</div>
          <div class="recovery-window-grid">
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="7" checked /><span>7 nap</span></label>
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="30" /><span>30 nap</span></label>
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="90" /><span>90 nap</span></label>
          </div>
        </div>

        <button id="recovery-submit" class="recovery-submit" type="submit">Vásárlás megkeresése</button>
        <p class="recovery-note">A keresés legfeljebb 40 egyező emailt vizsgál meg, és csak a biztonsági ellenőrzésen átment vásárlás kerülhet be automatikusan.</p>
      </form>

      <div id="recovery-result" hidden></div>
    </section>
  `;

  overlay.querySelectorAll<HTMLElement>('[data-recovery-close]').forEach((element) => {
    element.addEventListener('click', closeRecovery);
  });

  const form = overlay.querySelector<HTMLFormElement>('#recovery-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const input = overlay.querySelector<HTMLInputElement>('#recovery-search-term');
      const selected = overlay.querySelector<HTMLInputElement>('input[name="recovery-window"]:checked');
      const button = overlay.querySelector<HTMLButtonElement>('#recovery-submit');
      const result = overlay.querySelector<HTMLElement>('#recovery-result');
      const searchTerm = input?.value.trim() ?? '';
      const windowDays = Number(selected?.value ?? '7') as WindowDays;

      if (searchTerm.length < 2) {
        input?.focus();
        return;
      }

      if (button) {
        button.disabled = true;
        button.textContent = 'Keresés indítása…';
      }
      if (result) result.hidden = false;
      renderProgress('Keresés indítása…');

      try {
        const jobId = await startRecovery(searchTerm, windowDays);
        renderProgress('Keresés folyamatban…');
        await pollRecovery(jobId);
      } catch (error) {
        if (error instanceof Error && error.message === 'EMAIL_CONNECTION_REQUIRED') {
          renderFailure('Előbb csatlakoztasd a Gmail-fiókodat a Beállításokban.');
        } else if (error instanceof Error && error.message === 'SESSION_REQUIRED') {
          renderFailure('A bejelentkezés lejárt. Lépj be újra a BuyFlow-ba.');
        } else {
          renderFailure('A célzott keresést most nem sikerült elindítani. Próbáld újra később.');
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Vásárlás megkeresése';
        }
      }
    })();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  window.setTimeout(() => overlay.querySelector<HTMLInputElement>('#recovery-search-term')?.focus(), 250);
}

function enhancePurchasesPage() {
  if (document.querySelector('#missing-purchase-recovery')) return;
  const pages = Array.from(document.querySelectorAll<HTMLElement>('section.page'));
  const page = pages.find((candidate) => candidate.querySelector('h1')?.textContent?.trim() === 'Vásárlások');
  if (!page) return;

  const titleRow = page.querySelector('.page-title-row');
  if (!titleRow) return;

  const button = document.createElement('button');
  button.id = 'missing-purchase-recovery';
  button.className = 'recovery-entry-card';
  button.type = 'button';
  button.innerHTML = `
    <span class="recovery-entry-icon">⌕</span>
    <span class="recovery-entry-copy">
      <strong>Hiányzik egy vásárlásom</strong>
      <span>Keresés webshop vagy rendelési szám alapján</span>
    </span>
    <span class="recovery-entry-arrow">›</span>
  `;
  button.addEventListener('click', openRecovery);
  titleRow.insertAdjacentElement('afterend', button);
}

const observer = new MutationObserver(enhancePurchasesPage);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhancePurchasesPage();

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeRecovery();
});
