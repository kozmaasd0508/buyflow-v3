import './two-day-sync-policy.css';

function enhanceTwoDayPolicy() {
  const overlay = document.querySelector('#buyflow-gmail-settings-overlay');
  if (!overlay) return;

  overlay.querySelectorAll<HTMLElement>('.gmail-account-card').forEach((card) => {
    if (card.querySelector('.bf-two-day-policy')) return;
    const connection = card.querySelector('.gmail-connection-card');
    if (!connection) return;

    const policy = document.createElement('div');
    policy.className = 'bf-two-day-policy';
    policy.innerHTML = `
      <strong>Automatikus keresés: csak az elmúlt 2 nap</strong>
      <span>Az új leveleket ezután folyamatosan követjük. Régebbi rendeléshez használd a Vásárlások oldalon a célzott rendelés- és életútkeresést.</span>
    `;
    connection.insertAdjacentElement('afterend', policy);
  });
}

const observer = new MutationObserver(enhanceTwoDayPolicy);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceTwoDayPolicy();
