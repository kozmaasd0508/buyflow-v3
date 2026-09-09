import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './purchase-recovery-panel.css';

type WindowDays = 7 | 30 | 90 | 365;

interface RecoveryResult {
  checked: number;
  processed: number;
  unlinked: number;
  review: number;
  ignored: number;
  purchaseWrites: number;
  shipmentWrites: number;
  documentWrites: number;
  matchedPurchaseIds: string[];
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
    <p>A BuyFlow a találatból rendelési, tracking- és számlaazonosítókat követ tovább, hogy összeállítsa az életutat.</p>
  `;
}

function renderFailure(message: string) {
  const container = resultContainer();
  if (!container) return;
  container.className = 'recovery-result error';
  container.innerHTML = `<strong>Most nem sikerült</strong><p>${message}</p>`;
}

function journeyButtonHtml(safe: RecoveryResult): string {
  if (safe.matchedPurchaseIds.length === 1) {
    return '<button id="recovery-open-journey" class="recovery-refresh-button" type="button">Rendelés életútjának megnyitása</button>';
  }
  return '<button id="recovery-refresh-purchases" class="recovery-refresh-button" type="button">Vásárlások frissítése</button>';
}

function bindJourneyButton(safe: RecoveryResult) {
  const journey = document.querySelector<HTMLButtonElement>('#recovery-open-journey');
  journey?.addEventListener('click', () => {
    const purchaseId = safe.matchedPurchaseIds[0];
    if (!purchaseId) return;
    window.sessionStorage.setItem('buyflow-open-purchase-id', purchaseId);
    window.location.reload();
  });

  document.querySelector<HTMLButtonElement>('#recovery-refresh-purchases')?.addEventListener('click', () => {
    window.location.reload();
  });
}

function renderCompleted(result: RecoveryResult | null) {
  const container = resultContainer();
  if (!container) return;
  const safe: RecoveryResult = result ?? {
    checked: 0,
    processed: 0,
    unlinked: 0,
    review: 0,
    ignored: 0,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    matchedPurchaseIds: [],
  };
  safe.matchedPurchaseIds = Array.isArray(safe.matchedPurchaseIds) ? safe.matchedPurchaseIds : [];

  if (safe.purchaseWrites > 0 || safe.matchedPurchaseIds.length > 0) {
    container.className = 'recovery-result success';
    const title = safe.purchaseWrites > 0
      ? 'Megtaláltuk a hiányzó vásárlást.'
      : 'Megtaláltuk a rendelés életútját.';
    container.innerHTML = `
      <strong>${title}</strong>
      <p>${safe.checked} kapcsolódó emailt ellenőriztünk. A BuyFlow a megtalált azonosítókkal a rendelés további állomásait is célzottan megkereste.</p>
      ${journeyButtonHtml(safe)}
    `;
    bindJourneyButton(safe);
    return;
  }

  container.className = 'recovery-result';
  if (safe.checked === 0) {
    container.innerHTML = `
      <strong>Nem találtunk egyező emailt.</strong>
      <p>Próbáld meg a webshop nevét, rendelési számot vagy tracking számot másképp megadni, esetleg válassz hosszabb időszakot.</p>
    `;
    return;
  }

  if (safe.processed > 0) {
    container.className = 'recovery-result success';
    container.innerHTML = `
      <strong>Ezt a vásárlást már ismeri a BuyFlow.</strong>
      <p>${safe.checked} emailt ellenőriztünk, ebből ${safe.processed} már meglévő vásárlási adathoz kapcsolódik. Nem hoztunk létre másolatot.</p>
      <button id="recovery-refresh-purchases" class="recovery-refresh-button" type="button">Vásárlások megtekintése</button>
    `;
    bindJourneyButton(safe);
    return;
  }

  if (safe.unlinked > 0) {
    container.innerHTML = `
      <strong>Találtunk kapcsolódó emaileket.</strong>
      <p>${safe.checked} emailt ellenőriztünk. ${safe.unlinked} levelet felismertünk, de még nincs elég biztos adat egyetlen rendelési életút összekapcsolásához.</p>
    `;
    return;
  }

  if (safe.review > 0) {
    container.innerHTML = `
      <strong>Találtunk bizonytalan egyezést.</strong>
      <p>${safe.checked} emailt ellenőriztünk, de a BuyFlow nem kapott elég biztos bizonyítékot ahhoz, hogy automatikusan összekapcsolja őket.</p>
    `;
    return;
  }

  container.innerHTML = `
    <strong>Nem találtunk új vásárlást.</strong>
    <p>${safe.checked} emailt ellenőriztünk, de egyikből sem azonosítható biztonságosan a keresett rendelés.</p>
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
      renderProgress('Rendelés és életút keresése…');
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
    <section class="recovery-sheet" role="dialog" aria-modal="true" aria-label="Rendelés és életút keresése">
      <header class="recovery-header">
        <div>
          <p>BUYFLOW RECOVERY</p>
          <h2>Keress meg egy rendelést</h2>
        </div>
        <button class="recovery-close" type="button" data-recovery-close aria-label="Bezárás">×</button>
      </header>

      <p class="recovery-copy">Írd be a webshop nevét, rendelési számot vagy tracking számot. A BuyFlow először célzottan megtalálja a rendelést, majd a belőle kinyert azonosítókkal megkeresi a kapcsolódó fizetési, csomag-, kézbesítési és dokumentumleveleket is.</p>

      <form id="recovery-form" class="recovery-form">
        <label class="recovery-label">
          <span>Webshop, rendelési szám vagy tracking</span>
          <input id="recovery-search-term" class="recovery-input" type="text" minlength="2" maxlength="120" autocomplete="off" placeholder="pl. eMAG, 12345678 vagy Z3502850057" required />
        </label>

        <div>
          <div class="recovery-window-title">Milyen régen vásároltál?</div>
          <div class="recovery-window-grid">
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="7" /><span>7 nap</span></label>
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="30" checked /><span>30 nap</span></label>
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="90" /><span>90 nap</span></label>
            <label class="recovery-window-option"><input type="radio" name="recovery-window" value="365" /><span>1 év</span></label>
          </div>
        </div>

        <button id="recovery-submit" class="recovery-submit" type="submit">Rendelés és életút megkeresése</button>
        <p class="recovery-note">A keresés célzott. Nem olvassa újra a teljes postafiókot: az első találatból rendelési, tracking- és számlaazonosítókat használ a kapcsolódó életút felépítéséhez.</p>
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
      const windowDays = Number(selected?.value ?? '30') as WindowDays;

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
        renderProgress('Rendelés és életút keresése…');
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
          button.textContent = 'Rendelés és életút megkeresése';
        }
      }
    })();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  window.setTimeout(() => overlay.querySelector<HTMLInputElement>('#recovery-search-term')?.focus(), 250);
}

function maybeOpenRecoveredPurchase() {
  const purchaseId = window.sessionStorage.getItem('buyflow-open-purchase-id');
  if (!purchaseId) return;
  const card = document.querySelector<HTMLButtonElement>(`[data-purchase-id="${CSS.escape(purchaseId)}"]`);
  if (!card) return;
  window.sessionStorage.removeItem('buyflow-open-purchase-id');
  card.click();
}

function enhancePurchasesPage() {
  maybeOpenRecoveredPurchase();
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
      <strong>Rendelés célzott keresése</strong>
      <span>Webshop, rendelési szám vagy tracking alapján · teljes életúttal</span>
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
