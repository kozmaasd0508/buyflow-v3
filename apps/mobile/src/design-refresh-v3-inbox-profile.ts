import './design-refresh-v3-inbox-profile.css';

function addBrandMark(header: Element | null, symbol: string) {
  if (!header || header.querySelector('.bf-v3-sheet-brand')) return;
  const closeButton = header.querySelector(':scope > button');
  const mark = document.createElement('span');
  mark.className = 'bf-v3-sheet-brand';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = symbol;
  if (closeButton) header.insertBefore(mark, closeButton);
  else header.appendChild(mark);
}

function inboxSummary(list: Element): HTMLElement {
  const messages = Array.from(list.querySelectorAll('.shopping-inbox-message'));
  const linked = messages.filter((message) => message.querySelector('.shopping-inbox-linked')).length;
  const review = messages.filter((message) => message.querySelector('.shopping-inbox-type.review, .shopping-inbox-type.blocked')).length;

  const summary = document.createElement('div');
  summary.className = 'bf-v3-inbox-summary';
  summary.setAttribute('aria-label', 'Üzenetek összefoglaló');
  summary.innerHTML = `
    <div><small>Összes</small><strong>${messages.length}</strong></div>
    <div><small>Kapcsolt</small><strong>${linked}</strong></div>
    <div><small>Ellenőrzés</small><strong>${review}</strong></div>
  `;
  return summary;
}

function enhanceInbox() {
  const overlay = document.querySelector<HTMLElement>('#buyflow-shopping-inbox-overlay');
  if (!overlay) return;

  overlay.classList.add('bf-v3-inbox');
  const sheet = overlay.querySelector<HTMLElement>('.shopping-inbox-sheet');
  sheet?.classList.add('bf-v3-sheet');
  addBrandMark(overlay.querySelector('.shopping-inbox-header'), '✉');

  const body = overlay.querySelector<HTMLElement>('#shopping-inbox-body');
  const list = body?.querySelector('.shopping-inbox-list');
  if (!body || !list) return;

  const oldSummary = body.querySelector('.bf-v3-inbox-summary');
  const freshSummary = inboxSummary(list);
  if (oldSummary) {
    oldSummary.replaceWith(freshSummary);
    return;
  }

  const sectionHead = body.querySelector('.shopping-inbox-section-head');
  if (sectionHead) sectionHead.insertAdjacentElement('beforebegin', freshSummary);
  else list.insertAdjacentElement('beforebegin', freshSummary);
}

function enhanceProfile() {
  const overlay = document.querySelector<HTMLElement>('#buyflow-shopping-profile-overlay');
  if (!overlay) return;

  overlay.classList.add('bf-v3-profile');
  const sheet = overlay.querySelector<HTMLElement>('.shopping-profile-sheet');
  sheet?.classList.add('bf-v3-sheet');
  addBrandMark(overlay.querySelector('.shopping-profile-header'), '@');
}

let scheduled = false;
function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    enhanceInbox();
    enhanceProfile();
  });
}

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleEnhance();
