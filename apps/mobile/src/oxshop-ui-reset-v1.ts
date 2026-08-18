import './oxshop-ui-reset-v1.css';

function icon(name: 'search' | 'bell' | 'bag' | 'grid' | 'heart' | 'user' | 'truck', size = 20): string {
  const paths: Record<string, string> = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function clickRoute(route: string) {
  document.querySelector<HTMLButtonElement>(`.bottom-nav [data-route="${route}"]`)?.click();
}

function ensureOxTopbar() {
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!topbar || topbar.dataset.oxshop === '1') return;
  topbar.dataset.oxshop = '1';
  topbar.classList.add('oxshop-topbar');

  const brand = topbar.querySelector<HTMLElement>('.top-brand');
  if (brand) {
    brand.classList.add('oxshop-profile-head');
    const text = brand.querySelector<HTMLElement>('span:last-child');
    if (text) {
      text.innerHTML = '<small>BUYFLOW</small><strong>Vásárlásaid egy helyen</strong>';
    }
  }

  const actions = topbar.querySelector<HTMLElement>('.top-actions');
  if (actions && !actions.querySelector('.oxshop-bell')) {
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'oxshop-icon-button oxshop-bell';
    bell.setAttribute('aria-label', 'Üzenetek');
    bell.innerHTML = `${icon('bell', 19)}<span class="oxshop-dot"></span>`;
    bell.addEventListener('click', () => {
      const inboxButton = document.querySelector<HTMLButtonElement>('.bottom-nav [aria-label="Üzenetek"]');
      inboxButton?.click();
    });
    actions.prepend(bell);
  }
}

function ensureHomePromo(home: HTMLElement) {
  const welcome = home.querySelector<HTMLElement>('.welcome-card');
  if (!welcome || welcome.dataset.oxshop === '1') return;
  welcome.dataset.oxshop = '1';
  welcome.classList.add('oxshop-promo-card');

  const copy = welcome.querySelector<HTMLElement>('.welcome-copy');
  if (copy) {
    const eyebrow = copy.querySelector<HTMLElement>('.eyebrow');
    const title = copy.querySelector<HTMLElement>('h1');
    const description = copy.querySelector<HTMLElement>('p:last-child');
    if (eyebrow) eyebrow.textContent = 'BUYFLOW SHOPPING';
    if (title) title.textContent = 'Minden vásárlásod egy helyen';
    if (description) description.textContent = 'Rendelések, csomagok, számlák és garanciák egyetlen áttekinthető felületen.';

    if (!copy.querySelector('.oxshop-promo-action')) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'oxshop-promo-action';
      action.textContent = 'Vásárlások megnyitása';
      action.addEventListener('click', () => clickRoute('purchases'));
      copy.appendChild(action);
    }
  }

  const orb = welcome.querySelector<HTMLElement>('.welcome-orb');
  if (orb) {
    orb.classList.add('oxshop-promo-visual');
    orb.innerHTML = `${icon('bag', 34)}<span></span>`;
  }
}

function ensureHomeSearch(home: HTMLElement) {
  const search = home.querySelector<HTMLElement>('#bf-home-search');
  if (!search || search.dataset.oxshop === '1') return;
  search.dataset.oxshop = '1';
  search.classList.add('oxshop-search');
  search.querySelector('kbd')?.remove();
  const input = search.querySelector<HTMLInputElement>('input');
  if (input) input.placeholder = 'Keresés rendelés, webshop vagy termék szerint';

  if (!search.querySelector('.oxshop-search-filter')) {
    const filter = document.createElement('span');
    filter.className = 'oxshop-search-filter';
    filter.innerHTML = `${icon('grid', 18)}`;
    search.appendChild(filter);
  }
}

function createQuickCategories(home: HTMLElement) {
  if (home.querySelector('.oxshop-category-section')) return;
  const search = home.querySelector('#bf-home-search');
  if (!search) return;

  const section = document.createElement('section');
  section.className = 'oxshop-category-section';
  section.innerHTML = `
    <div class="oxshop-section-row"><div><span>GYORS ELÉRÉS</span><h2>Kategóriák</h2></div><button type="button" data-ox-all>Összes</button></div>
    <div class="oxshop-category-strip">
      <button type="button" data-ox-route="orders"><span>${icon('truck', 21)}</span><strong>Csomagok</strong></button>
      <button type="button" data-ox-route="purchases"><span>${icon('bag', 21)}</span><strong>Vásárlások</strong></button>
      <button type="button" data-ox-inbox><span>${icon('bell', 21)}</span><strong>Üzenetek</strong></button>
      <button type="button" data-ox-account><span>${icon('user', 21)}</span><strong>Profil</strong></button>
    </div>
  `;
  search.insertAdjacentElement('afterend', section);
  section.querySelectorAll<HTMLButtonElement>('[data-ox-route]').forEach((button) => {
    button.addEventListener('click', () => clickRoute(button.dataset.oxRoute ?? 'home'));
  });
  section.querySelector<HTMLButtonElement>('[data-ox-all]')?.addEventListener('click', () => clickRoute('purchases'));
  section.querySelector<HTMLButtonElement>('[data-ox-inbox]')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.bottom-nav [aria-label="Üzenetek"]')?.click();
  });
  section.querySelector<HTMLButtonElement>('[data-ox-account]')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('.avatar-button')?.click();
  });
}

function styleOverview(home: HTMLElement) {
  const grid = home.querySelector<HTMLElement>('.home-grid');
  if (!grid || grid.dataset.oxshop === '1') return;
  grid.dataset.oxshop = '1';
  grid.classList.add('oxshop-stat-strip');

  const section = grid.closest<HTMLElement>('.content-section');
  if (section) {
    section.classList.add('oxshop-overview-section');
    const eyebrow = section.querySelector<HTMLElement>('.section-head .eyebrow');
    const title = section.querySelector<HTMLElement>('.section-head h2');
    if (eyebrow) eyebrow.textContent = 'ÁLLAPOT';
    if (title) title.textContent = 'Aktuális vásárlásaid';
  }
}

function styleLatestCards(home: HTMLElement) {
  const cards = Array.from(home.querySelectorAll<HTMLElement>('.entity-card'));
  for (const card of cards) card.classList.add('oxshop-product-card');

  const sections = Array.from(home.querySelectorAll<HTMLElement>('.content-section'));
  for (const section of sections) {
    if (section.querySelector('.entity-card')) section.classList.add('oxshop-latest-section');
  }
}

function ensureHome() {
  const home = document.querySelector<HTMLElement>('.home-page');
  if (!home) return;
  document.documentElement.classList.add('oxshop-ui-reset');
  home.classList.add('oxshop-home');
  ensureHomePromo(home);
  ensureHomeSearch(home);
  createQuickCategories(home);
  styleOverview(home);
  styleLatestCards(home);
}

function ensureBottomNav() {
  const nav = document.querySelector<HTMLElement>('.bottom-nav');
  if (!nav || nav.dataset.oxshop === '1') return;
  nav.dataset.oxshop = '1';
  nav.classList.add('oxshop-bottom-nav');

  const labels = ['Kezdőlap', 'Rendelések', 'Vásárlások', 'Üzenetek', 'Profil'];
  Array.from(nav.querySelectorAll<HTMLElement>('.nav-item')).forEach((item, index) => {
    item.classList.add('oxshop-nav-item');
    const span = item.querySelector<HTMLElement>('span');
    if (span && labels[index]) span.textContent = labels[index];
  });
}

function ensurePages() {
  document.querySelectorAll<HTMLElement>('.page:not(.home-page)').forEach((page) => page.classList.add('oxshop-page'));
  document.querySelectorAll<HTMLElement>('.entity-card').forEach((card) => card.classList.add('oxshop-entity-card'));
  document.querySelectorAll<HTMLElement>('.glass-panel').forEach((panel) => panel.classList.add('oxshop-glass-panel'));
}

function enhance() {
  ensureOxTopbar();
  ensureHome();
  ensureBottomNav();
  ensurePages();
}

const observer = new MutationObserver(() => enhance());
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
