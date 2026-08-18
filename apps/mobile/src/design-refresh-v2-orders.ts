import './design-refresh-v2-orders.css';

function lifecycleProgress(label: string): { count: number; terminal: 'normal' | 'complete' | 'stopped' } {
  const value = label.trim().toLocaleLowerCase('hu-HU');

  if (value.includes('töröl') || value.includes('visszatér')) {
    return { count: 4, terminal: 'stopped' };
  }
  if (value.includes('kézbesít') || value.includes('megérkez')) {
    return { count: 4, terminal: 'complete' };
  }
  if (value.includes('átvehető') || value.includes('ma érkez') || value.includes('úton') || value.includes('felad')) {
    return { count: 3, terminal: 'normal' };
  }
  if (value.includes('fizet')) {
    return { count: 2, terminal: 'normal' };
  }
  return { count: 1, terminal: 'normal' };
}

function progressHtml(label: string): string {
  const progress = lifecycleProgress(label);
  return `<span class="bf-v2-card-progress" aria-hidden="true">${[0, 1, 2, 3].map((index) => {
    if (index >= progress.count) return '<span></span>';
    if (progress.terminal === 'complete' && index === 3) return '<span class="complete"></span>';
    if (progress.terminal === 'stopped') return '<span class="stopped"></span>';
    return '<span class="done"></span>';
  }).join('')}</span>`;
}

function enhanceListPages() {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('section.page'));
  for (const page of pages) {
    const title = page.querySelector('h1')?.textContent?.trim();
    if (title !== 'Rendelések' && title !== 'Vásárlások') continue;
    page.classList.add('bf-v2-list-page');

    page.querySelectorAll<HTMLElement>('.entity-card').forEach((card) => {
      if (card.dataset.bfV2Orders === '1') return;
      card.dataset.bfV2Orders = '1';
      card.classList.add('bf-v2-entity-card');

      const main = card.querySelector<HTMLElement>('.entity-main');
      const badge = card.querySelector<HTMLElement>('.badge');
      if (!main || !badge) return;
      main.insertAdjacentHTML('beforeend', progressHtml(badge.textContent ?? ''));
    });
  }
}

function detailHeroIcon(): string {
  return `
    <span class="bf-v2-hero-icon" aria-hidden="true">
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="m4 7 8-4 8 4-8 4z"/>
        <path d="M4 7v10l8 4 8-4V7"/>
        <path d="M12 11v10"/>
      </svg>
    </span>
  `;
}

function enhanceDetailPage() {
  const page = document.querySelector<HTMLElement>('.detail-page');
  if (!page) return;
  page.classList.add('bf-v2-detail-page');

  const hero = page.querySelector<HTMLElement>('.order-hero');
  if (hero && hero.dataset.bfV2Hero !== '1') {
    hero.dataset.bfV2Hero = '1';
    hero.insertAdjacentHTML('beforeend', detailHeroIcon());
  }

  page.querySelectorAll<HTMLElement>('.content-section').forEach((section) => {
    if (section.dataset.bfV2Section === '1') return;
    section.dataset.bfV2Section = '1';
    const eyebrow = section.querySelector<HTMLElement>('.eyebrow')?.textContent?.trim().toLocaleLowerCase('hu-HU') ?? '';
    if (eyebrow) {
      section.dataset.bfSectionKind = eyebrow
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });
}

function enhanceBuyFlowV2() {
  enhanceListPages();
  enhanceDetailPage();
}

const observer = new MutationObserver(enhanceBuyFlowV2);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceBuyFlowV2();
