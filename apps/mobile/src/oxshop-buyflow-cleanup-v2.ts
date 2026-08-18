import './oxshop-buyflow-cleanup-v2.css';

function removeBuyFlowFunctionsBlock() {
  document.querySelector('.oxshop-category-section')?.remove();
}

function cleanLegacyAuditUi() {
  document.querySelectorAll<HTMLElement>(
    '.scan-review-actions, .gmail-scan-actions, .gmail-scan-results, .gmail-scan-finished, #buyflow-deterministic-mode-note, #start-full-ai-audit, #view-full-ai-audit, #scan-seven-days-button',
  ).forEach((element) => element.remove());

  document.querySelectorAll<HTMLElement>('[data-audit-window]').forEach((element) => element.remove());
}

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

function cleanSettingsCopy() {
  document.querySelectorAll<HTMLElement>('.gmail-help').forEach((element) => {
    const text = element.textContent ?? '';
    if (/7 nap|ellenőrzés|átnézés/i.test(text)) element.remove();
  });

  document.querySelectorAll<HTMLElement>('.gmail-meta').forEach((element) => {
    const text = element.textContent ?? '';
    if (/első ellenőrzés/i.test(text)) element.remove();
  });
}

function enhance() {
  removeBuyFlowFunctionsBlock();
  cleanLegacyAuditUi();
  makeSettingsUserFacing();
  cleanSettingsCopy();
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
