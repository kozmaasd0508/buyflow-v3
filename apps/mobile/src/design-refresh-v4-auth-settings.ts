import './design-refresh-v4-auth-settings.css';

function enhanceLogin() {
  const card = document.querySelector<HTMLElement>('.auth-card');
  if (!card || card.dataset.bfV4Auth === '1') return;
  card.dataset.bfV4Auth = '1';
  card.classList.add('bf-v4-auth-card');

  const copy = card.querySelector('.auth-copy');
  if (copy && !card.querySelector('.bf-v4-auth-features')) {
    const features = document.createElement('div');
    features.className = 'bf-v4-auth-features';
    features.innerHTML = `
      <div><span>01</span><strong>Vásárlások</strong><small>Egy helyen</small></div>
      <div><span>02</span><strong>Csomagok</strong><small>Átláthatóan</small></div>
      <div><span>03</span><strong>Dokumentumok</strong><small>Későbbre is</small></div>
    `;
    copy.insertAdjacentElement('afterend', features);
  }
}

function enhanceAccountPopover() {
  const popover = document.querySelector<HTMLElement>('.account-popover');
  if (!popover || popover.dataset.bfV4Account === '1') return;
  popover.dataset.bfV4Account = '1';
  popover.classList.add('bf-v4-account-popover');

  const user = popover.querySelector('.account-popover-user');
  if (user && !popover.querySelector('.bf-v4-account-kicker')) {
    const kicker = document.createElement('div');
    kicker.className = 'bf-v4-account-kicker';
    kicker.textContent = 'SAJÁT BUYFLOW';
    user.insertAdjacentElement('beforebegin', kicker);
  }
}

function enhanceSettings() {
  const sheet = document.querySelector<HTMLElement>('.settings-sheet');
  if (!sheet || sheet.dataset.bfV4Settings === '1') return;
  sheet.dataset.bfV4Settings = '1';
  sheet.classList.add('bf-v4-settings-sheet');

  const profile = sheet.querySelector<HTMLElement>('.settings-profile-card');
  profile?.classList.add('bf-v4-settings-profile');

  const gmailCard = sheet.querySelector<HTMLElement>('.gmail-connection-card');
  gmailCard?.classList.add('bf-v4-gmail-card');

  const infoCard = sheet.querySelector<HTMLElement>('.settings-info-card');
  infoCard?.classList.add('bf-v4-settings-info');
}

function enhanceAll() {
  enhanceLogin();
  enhanceAccountPopover();
  enhanceSettings();
}

const observer = new MutationObserver(enhanceAll);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceAll();
