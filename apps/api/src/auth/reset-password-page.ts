const SUPABASE_URL = 'https://acjenqkrvnkdvvgordry.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp';

export function passwordResetPageHtml(): string {
  return `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>BuyFlow – Új jelszó</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#111827; background:#f3f5f9; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:radial-gradient(circle at top right, rgba(99,102,241,.09), transparent 34%), #f3f5f9; }
    .card { width:min(100%, 430px); background:#fff; border:1px solid rgba(17,24,39,.08); border-radius:28px; padding:28px; box-shadow:0 28px 70px rgba(15,23,42,.11); }
    .brand { display:flex; gap:14px; align-items:center; margin-bottom:22px; }
    .mark { display:grid; place-items:center; width:50px; height:50px; border-radius:16px; color:#fff; font-size:23px; font-weight:800; background:linear-gradient(145deg,#111827,#3730a3); }
    .eyebrow { color:#6366f1; font-size:11px; font-weight:800; letter-spacing:.14em; }
    h1 { margin:3px 0 0; font-size:29px; line-height:1.05; letter-spacing:-.035em; }
    p { color:#6b7280; font-size:14px; line-height:1.55; }
    form { display:grid; gap:15px; margin-top:20px; }
    label { display:grid; gap:7px; color:#374151; font-size:13px; font-weight:700; }
    input { min-height:50px; width:100%; border:1px solid #dbe0ea; border-radius:14px; padding:0 14px; font:inherit; }
    input:focus { outline:3px solid rgba(79,70,229,.18); border-color:#818cf8; }
    .password-hint { margin:-5px 0 0; color:#6b7280; font-size:12px; line-height:1.45; }
    button { min-height:52px; border:0; border-radius:14px; cursor:pointer; background:linear-gradient(135deg,#111827,#4338ca); color:#fff; font:inherit; font-weight:800; box-shadow:0 14px 28px rgba(67,56,202,.18); }
    button:disabled { opacity:.58; cursor:default; }
    .status { display:none; margin-top:16px; padding:12px 14px; border-radius:14px; font-size:13px; line-height:1.45; }
    .status.ok { display:block; color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; }
    .status.error { display:block; color:#9f1239; background:#fff1f2; border:1px solid #fecaca; }
    .hidden { display:none; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <div class="mark">B</div>
      <div>
        <div class="eyebrow">BUYFLOW</div>
        <h1>Új jelszó beállítása</h1>
      </div>
    </div>

    <p id="intro">Adj meg egy új, erős jelszót a BuyFlow-fiókodhoz.</p>

    <form id="reset-form" class="hidden">
      <label>
        <span>Új jelszó</span>
        <input id="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" aria-describedby="password-hint" required />
      </label>
      <p id="password-hint" class="password-hint">Legalább 12 karakter, kis- és nagybetű, szám és speciális karakter.</p>
      <label>
        <span>Új jelszó még egyszer</span>
        <input id="password-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
      </label>
      <button id="submit-button" type="submit">Jelszó mentése</button>
    </form>

    <div id="status" class="status" aria-live="polite"></div>
  </main>

  <script>
    const supabaseUrl = ${JSON.stringify(SUPABASE_URL)};
    const publishableKey = ${JSON.stringify(SUPABASE_PUBLISHABLE_KEY)};
    const form = document.getElementById('reset-form');
    const status = document.getElementById('status');
    const intro = document.getElementById('intro');
    const submitButton = document.getElementById('submit-button');

    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const recoveryType = hash.get('type');

    // The recovery JWT is sensitive. Keep it only in memory after the page has loaded,
    // and remove it from the visible URL immediately rather than waiting for success.
    if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }

    function showStatus(message, kind) {
      status.textContent = message;
      status.className = 'status ' + kind;
    }

    function passwordPolicyError(password) {
      if (password.length < 12) return 'Az új jelszó legyen legalább 12 karakter hosszú.';
      if (password.length > 128) return 'Az új jelszó legfeljebb 128 karakter lehet.';
      if (!/[a-z]/.test(password)) return 'Az új jelszó tartalmazzon legalább egy kisbetűt.';
      if (!/[A-Z]/.test(password)) return 'Az új jelszó tartalmazzon legalább egy nagybetűt.';
      if (!/[0-9]/.test(password)) return 'Az új jelszó tartalmazzon legalább egy számot.';
      if (!/[^A-Za-z0-9]/.test(password)) return 'Az új jelszó tartalmazzon legalább egy speciális karaktert.';
      return null;
    }

    if (!accessToken || recoveryType !== 'recovery') {
      intro.textContent = 'Ez a jelszó-visszaállító link hiányos vagy már lejárt.';
      showStatus('Kérj új jelszó-visszaállító emailt a BuyFlow alkalmazásból.', 'error');
    } else {
      form.classList.remove('hidden');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!accessToken) return;

      const password = document.getElementById('password').value;
      const confirmation = document.getElementById('password-confirm').value;
      const policyError = passwordPolicyError(password);

      if (policyError) {
        showStatus(policyError, 'error');
        return;
      }
      if (password !== confirmation) {
        showStatus('A két jelszó nem egyezik.', 'error');
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Mentés…';

      try {
        const response = await fetch(supabaseUrl + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            apikey: publishableKey,
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password }),
        });

        if (!response.ok) {
          let errorCode = '';
          try {
            const errorBody = await response.json();
            errorCode = typeof errorBody?.code === 'string' ? errorBody.code : '';
          } catch {
            errorCode = '';
          }

          if (errorCode === 'weak_password') {
            showStatus('A Supabase biztonsági ellenőrzése ezt a jelszót túl gyengének vagy ismertnek találta. Válassz másik, egyedi jelszót.', 'error');
          } else {
            showStatus('A link lejárt vagy nem érvényes. Kérj új jelszó-visszaállító emailt.', 'error');
          }
          return;
        }

        form.classList.add('hidden');
        intro.textContent = 'Kész.';
        showStatus('Az új jelszavad elmentve. Most visszaléphetsz a BuyFlow alkalmazásba és bejelentkezhetsz vele.', 'ok');
      } catch {
        showStatus('Nem sikerült kapcsolódni a szerverhez. Próbáld újra.', 'error');
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Jelszó mentése';
      }
    });
  </script>
</body>
</html>`;
}
