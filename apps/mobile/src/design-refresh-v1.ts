import './design-refresh-v1.css';

let activePurchaseQuery = '';

function searchIcon(size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>`;
}

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function purchasesPage(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('section.page'))
    .find((page) => page.querySelector('h1')?.textContent?.trim() === 'Vásárlások') ?? null;
}

function applyPurchaseFilter(page: HTMLElement) {
  const query = normalizedSearch(activePurchaseQuery);
  const cards = Array.from(page.querySelectorAll<HTMLElement>('.entity-card'));
  let visible = 0;

  for (const card of cards) {
    const match = !query || normalizedSearch(card.textContent ?? '').includes(query);
    card.hidden = !match;
    if (match) visible += 1;
  }

  let summary = page.querySelector<HTMLElement>('#bf-filter-summary');
  if (!summary) {
    summary = document.createElement('p');
    summary.id = 'bf-filter-summary';
    summary.className = 'bf-filter-summary';
    const search = page.querySelector('#bf-purchases-search');
    search?.insertAdjacentElement('afterend', summary);
  }

  if (!summary) return;
  if (!query) {
    summary.textContent = '';
    summary.hidden = true;
    return;
  }

  summary.hidden = false;
  summary.textContent = visible > 0
    ? `${visible} találat a betöltött vásárlások között.`
    : 'Nincs találat a betöltött vásárlások között.';
}

function enhancePurchasesSearch() {
  const page = purchasesPage();
  if (!page || page.querySelector('#bf-purchases-search')) return;

  const titleRow = page.querySelector('.page-title-row');
  if (!titleRow) return;

  const search = document.createElement('label');
  search.id = 'bf-purchases-search';
  search.className = 'bf-purchases-search';
  search.innerHTML = `${searchIcon()}<input type="search" autocomplete="off" placeholder="Webshop, rendelési szám vagy termék…" aria-label="Vásárlások keresése" />`;
  titleRow.insertAdjacentElement('afterend', search);

  const input = search.querySelector<HTMLInputElement>('input');
  if (!input) return;
  input.value = activePurchaseQuery;
  input.addEventListener('input', () => {
    activePurchaseQuery = input.value;
    applyPurchaseFilter(page);
  });

  applyPurchaseFilter(page);
}

function openPurchasesWithQuery(query: string) {
  activePurchaseQuery = query.trim();
  const button = document.querySelector<HTMLButtonElement>('.bottom-nav [data-route="purchases"]');
  if (!button) return;
  button.click();
  window.setTimeout(() => {
    enhancePurchasesSearch();
    const page = purchasesPage();
    if (page) applyPurchaseFilter(page);
  }, 0);
}

function enhanceHomeSearch() {
  const home = document.querySelector<HTMLElement>('.home-page');
  if (!home || home.querySelector('#bf-home-search')) return;

  const welcome = home.querySelector('.welcome-card');
  if (!welcome) return;

  const form = document.createElement('form');
  form.id = 'bf-home-search';
  form.className = 'bf-home-search';
  form.setAttribute('role', 'search');
  form.innerHTML = `${searchIcon()}<input type="search" autocomplete="off" placeholder="Rendelés, webshop, termék keresése…" aria-label="Keresés a vásárlások között" /><kbd>KERESÉS</kbd>`;
  welcome.insertAdjacentElement('afterend', form);

  const input = form.querySelector<HTMLInputElement>('input');
  if (!input) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    openPurchasesWithQuery(input.value);
  });
}

function enhance() {
  enhanceHomeSearch();
  enhancePurchasesSearch();
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
