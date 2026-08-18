import './oxshop-buyflow-cleanup-v2.css';

function makeSettingsUserFacing() {
  const gmailButton = document.querySelector<HTMLButtonElement>('#gmail-settings-button');
  if (gmailButton && gmailButton.dataset.buyflowSettingsV2 !== '1') {
    gmailButton.dataset.buyflowSettingsV2 = '1';
    gmailButton.innerHTML = '<span class="gmail-account-icon">⚙</span><span>Beállítások</span>';
  }

  const gmailSheet = document.querySelector<HTMLElement>('.gmail-settings-sheet');
  if (gmailSheet) {
    gmailSheet.classList.add('buyflow-full-settings');
    const kicker = gmailSheet.querySelector<HTMLElement>('.gmail-settings-header p');
    const title = gmailSheet.querySelector<HTMLElement>('.gmail-settings-header h2');
    if (kicker) kicker.textContent = 'BUYFLOW';
    if (title) title.textContent = 'Beállítások';
  }

  const legacySheet = document.querySelector<HTMLElement>('.settings-sheet');
  legacySheet?.classList.add('buyflow-full-settings');

  const toolbar = document.querySelector<HTMLElement>('.gmail-settings-toolbar');
  if (toolbar) {
    const strong = toolbar.querySelector<HTMLElement>('div > strong');
    const span = toolbar.querySelector<HTMLElement>('div > span');
    if (strong) strong.textContent = 'Email kapcsolat';
    if (span) span.textContent = 'A csatlakoztatott email-fiókok állapotát itt kezelheted.';
  }

  const explainer = document.querySelector<HTMLElement>('.gmail-settings-explainer');
  if (explainer) {
    const strong = explainer.querySelector<HTMLElement>('strong');
    const copy = explainer.querySelector<HTMLElement>('p');
    if (strong) strong.textContent = 'Hogyan működik?';
    if (copy) copy.textContent = 'A BuyFlow a vásárlásokhoz kapcsolódó leveleket biztonságos, ellenőrizhető szabályokkal rendezi a megfelelő vásárlásokhoz. Bizonytalan esetben nem találgat.';
  }
}

function enhance() {
  // Visibility is handled in CSS instead of removing DOM nodes. Several legacy
  // UI enhancers use MutationObserver and would otherwise recreate removed
  // elements, causing old controls to reappear or observers to fight each other.
  makeSettingsUserFacing();
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
