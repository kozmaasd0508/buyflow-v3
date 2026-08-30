import './ambient-fix.css';
import './settings-panel.js';
import './purchase-recovery-panel.js';
import './email-scan-review-panel.js';
import { supabase } from './supabase.js';

const RESET_URL = 'https://buyflow-v3-api-dev.onrender.com/auth/reset-password';

function ensureStyles() {
  if (document.querySelector('#buyflow-password-reset-style')) return;
  const style = document.createElement('style');
  style.id = 'buyflow-password-reset-style';
  style.textContent = `
    .forgot-password-button {
      width: 100%;
      margin-top: 12px;
      border: 0;
      background: transparent;
      color: #4f46e5;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      text-align: center;
      padding: 8px 4px;
    }
    .forgot-password-button:disabled {
      opacity: .58;
      cursor: default;
    }
  `;
  document.head.appendChild(style);
}

async function requestPasswordReset(button: HTMLButtonElement) {
  const emailInput = document.querySelector<HTMLInputElement>('#email');
  const email = emailInput?.value.trim() ?? '';

  if (!email) {
    window.alert('Előbb írd be az email címedet, amihez a BuyFlow-fiók tartozik.');
    emailInput?.focus();
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Email küldése…';

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_URL,
    });

    if (error) {
      window.alert('Most nem sikerült elküldeni a jelszó-visszaállító emailt. Próbáld újra pár perc múlva.');
      return;
    }

    window.alert('Elküldtük a jelszó-visszaállító emailt. Nyisd meg az emailben lévő linket, és állíts be egy új jelszót.');
  } finally {
    button.disabled = false;
    button.textContent = originalText ?? 'Elfelejtettem a jelszót';
  }
}

function attachPasswordResetButton() {
  const loginForm = document.querySelector<HTMLFormElement>('#login-form');
  if (!loginForm || document.querySelector('#forgot-password-button')) return;

  ensureStyles();
  const button = document.createElement('button');
  button.id = 'forgot-password-button';
  button.className = 'forgot-password-button';
  button.type = 'button';
  button.textContent = 'Elfelejtettem a jelszót';
  button.addEventListener('click', () => {
    void requestPasswordReset(button);
  });

  loginForm.insertAdjacentElement('afterend', button);
}

const observer = new MutationObserver(() => attachPasswordResetButton());
observer.observe(document.documentElement, { childList: true, subtree: true });
attachPasswordResetButton();
