import './oxshop-buyflow-cleanup-v1.css';

function profileIcon(size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
}

function openProfile() {
  const account = document.querySelector<HTMLButtonElement>('#account-button');
  if (!account) return;
  account.click();
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('#shopping-profile-button')?.click();
  }, 35);
}

function cleanTopbar() {
  document.querySelector('.oxshop-bell .oxshop-dot')?.remove();
}

function cleanSearch() {
  document.querySelector('.oxshop-search-filter')?.remove();
}

function cleanQuickAccess() {
  const section = document.querySelector<HTMLElement>('.oxshop-category-section');
  if (!section || section.dataset.buyflowClean === '1') return;
  section.dataset.buyflowClean = '1';

  const kicker = section.querySelector<HTMLElement>('.oxshop-section-row span');
  const title = section.querySelector<HTMLElement>('.oxshop-section-row h2');
  if (kicker) kicker.textContent = 'GYORS ELÉRÉS';
  if (title) title.textContent = 'BuyFlow funkciók';
  section.querySelector<HTMLButtonElement>('[data-ox-all]')?.remove();

  const buttons = Array.from(section.querySelectorAll<HTMLButtonElement>('.oxshop-category-strip > button'));
  const profile = buttons[3];
  if (profile) {
    profile.removeAttribute('data-ox-account');
    profile.innerHTML = `<span>${profileIcon(21)}</span><strong>Profil</strong>`;
    profile.addEventListener('click', openProfile);
  }
}

function cleanHomeDuplicates() {
  document.querySelector<HTMLElement>('.home-page .quick-grid')?.classList.add('buyflow-cleanup-hidden');
}

function cleanBottomNav() {
  const nav = document.querySelector<HTMLElement>('.bottom-nav');
  if (!nav) return;
  const items = Array.from(nav.querySelectorAll<HTMLButtonElement>('.nav-item'));
  if (items.length < 5) return;

  // Shopping Inbox owns item 4 (index 3). Keep that live behavior intact.
  const profile = items[4];
  if (profile.dataset.buyflowProfileNav !== '1') {
    profile.dataset.buyflowProfileNav = '1';
    profile.removeAttribute('data-route');
    profile.setAttribute('aria-label', 'Profil');
    profile.classList.remove('active');
    profile.innerHTML = `${profileIcon(21)}<span>Profil</span>`;
    profile.addEventListener('click', openProfile);
  }
}

function cleanLegacyLabels() {
  const promo = document.querySelector<HTMLElement>('.oxshop-promo-card');
  if (promo && promo.dataset.buyflowClean !== '1') {
    promo.dataset.buyflowClean = '1';
    const eyebrow = promo.querySelector<HTMLElement>('.eyebrow');
    const title = promo.querySelector<HTMLElement>('h1');
    const description = promo.querySelector<HTMLElement>('.welcome-copy > p:last-of-type');
    if (eyebrow) eyebrow.textContent = 'BUYFLOW';
    if (title) title.textContent = 'Vásárlásaid, automatikusan rendezve';
    if (description) description.textContent = 'Rendelések, csomagok, számlák és garanciák egyetlen áttekinthető helyen.';
  }
}

function enhance() {
  cleanTopbar();
  cleanSearch();
  cleanQuickAccess();
  cleanHomeDuplicates();
  cleanBottomNav();
  cleanLegacyLabels();
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
