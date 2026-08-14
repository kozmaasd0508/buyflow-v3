import './ai-off-ui.css';

function deterministicModeNote(): HTMLElement {
  const note = document.createElement('div');
  note.id = 'buyflow-deterministic-mode-note';
  note.className = 'deterministic-mode-note';
  note.innerHTML = `
    <span class="deterministic-mode-dot" aria-hidden="true"></span>
    <div>
      <strong>Szabályalapú mód aktív</strong>
      <span>Az AI most ki van kapcsolva. A BuyFlow csak a saját, ellenőrizhető keresési és felismerési szabályait használja.</span>
    </div>
  `;
  return note;
}

function applyAiOffUi() {
  document.querySelectorAll<HTMLElement>('[data-route="flow"]').forEach((element) => {
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
  });

  const connected = document.querySelector<HTMLElement>('#gmail-connection-content.connected');
  if (connected && !connected.querySelector('#buyflow-deterministic-mode-note')) {
    connected.prepend(deterministicModeNote());
  }

  const disconnected = document.querySelector<HTMLElement>('#gmail-connection-content.disconnected');
  if (disconnected && !disconnected.querySelector('#buyflow-deterministic-mode-note')) {
    disconnected.prepend(deterministicModeNote());
  }
}

const observer = new MutationObserver(applyAiOffUi);
observer.observe(document.documentElement, { childList: true, subtree: true });
applyAiOffUi();
