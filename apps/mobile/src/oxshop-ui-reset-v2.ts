import './oxshop-ui-reset-v2.css';

function enhance() {
  document.documentElement.classList.add('oxshop-ui-reset-v2');
  document.querySelector<HTMLElement>('.detail-page')?.classList.add('oxshop-detail-page');
  document.querySelector<HTMLElement>('.detail-topbar')?.classList.add('oxshop-detail-topbar');
  document.querySelector<HTMLElement>('.shopping-inbox-sheet')?.classList.add('oxshop-sheet', 'oxshop-inbox-sheet');
  document.querySelector<HTMLElement>('.shopping-profile-sheet')?.classList.add('oxshop-sheet', 'oxshop-profile-sheet');
  document.querySelector<HTMLElement>('.settings-sheet')?.classList.add('oxshop-settings-sheet');
  document.querySelector<HTMLElement>('.auth-card')?.classList.add('oxshop-auth-card');

  document.querySelectorAll<HTMLElement>('.detail-card, .documents-card, .buyflow-status-card, .buyflow-timeline-card').forEach((card) => {
    card.classList.add('oxshop-detail-card');
  });
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhance();
