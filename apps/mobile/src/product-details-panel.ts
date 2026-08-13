import type { ProductSummary } from './api.js';
import { mobileConfig } from './config.js';
import { supabase } from './supabase.js';
import './product-details-panel.css';

interface VisibleProductsResponse {
  products: ProductSummary[];
  hiddenCount: number;
}

let selectedPurchaseId: string | null = null;
let loadingPurchaseId: string | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat('hu-HU', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'HUF' ? 0 : 2,
      }).format(numeric);
    } catch {
      // Fall through for unknown currency codes.
    }
  }
  return `${new Intl.NumberFormat('hu-HU').format(numeric)}${currency ? ` ${escapeHtml(currency)}` : ''}`;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_EXPIRED');
  return token;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401) throw new Error('SESSION_EXPIRED');
  if (!response.ok) throw new Error(`API_${response.status}`);
  return await response.json() as T;
}

async function loadVisibleProducts(purchaseId: string): Promise<VisibleProductsResponse> {
  return await apiRequest<VisibleProductsResponse>(
    `/api/purchases/${encodeURIComponent(purchaseId)}/visible-products`,
  );
}

async function hideProduct(productId: string): Promise<void> {
  await apiRequest(`/api/products/${encodeURIComponent(productId)}/hide`, { method: 'POST' });
}

function productCard(product: ProductSummary): string {
  const imageUrl = safeHttpUrl(product.imageUrl);
  const productUrl = safeHttpUrl(product.productUrl);
  const price = product.totalPrice ?? product.unitPrice;
  const secondary = [product.brand, product.model, product.variant]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const identifiers = [
    product.sku ? `Cikkszám: ${product.sku}` : null,
    product.gtin ? `GTIN: ${product.gtin}` : null,
  ].filter((value): value is string => Boolean(value));

  return `
    <article class="buyflow-product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="buyflow-product-media ${imageUrl ? 'has-image' : ''}">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
          : '<span aria-hidden="true">◫</span>'}
      </div>
      <div class="buyflow-product-content">
        <div class="buyflow-product-heading">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            ${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}
          </div>
          ${product.quantity !== null ? `<span class="buyflow-product-qty">${escapeHtml(product.quantity)} db</span>` : ''}
        </div>
        ${identifiers.length > 0 ? `<div class="buyflow-product-identifiers">${identifiers.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''}
        <div class="buyflow-product-bottom">
          <strong>${formatMoney(price, product.currency)}</strong>
          <div class="buyflow-product-actions">
            ${productUrl ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">Termék megnyitása</a>` : ''}
            <button class="buyflow-product-remove" type="button" data-hide-product="${escapeHtml(product.id)}">Eltávolítás</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function sectionHtml(data: VisibleProductsResponse): string {
  const body = data.products.length > 0
    ? `<div class="buyflow-products-grid">${data.products.map(productCard).join('')}</div>`
    : '<div class="detail-empty">A rendelésben jelenleg nincs megjelenített termék.</div>';
  const hiddenNote = data.hiddenCount > 0
    ? `<div class="buyflow-product-override-note">${data.hiddenCount} korábban eltávolított termék rejtve marad az AI későbbi frissítései után is.</div>`
    : '';

  return `
    <section class="content-section buyflow-products-v2-section" data-buyflow-products="ready">
      <div class="section-head">
        <div>
          <p class="eyebrow">TERMÉKEK</p>
          <h2>${data.products.length > 0 ? `${data.products.length} termék a rendelésben` : 'Termékek'}</h2>
        </div>
      </div>
      ${hiddenNote}
      ${body}
    </section>
  `;
}

function loadingHtml(): string {
  return `
    <div class="section-head"><div><p class="eyebrow">TERMÉKEK</p><h2>Rendelés tartalma</h2></div></div>
    <div class="loading-card"><div class="spinner small"></div>Termékadatok betöltése…</div>
  `;
}

function createSection(html: string): HTMLElement | null {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return wrapper.firstElementChild as HTMLElement | null;
}

function insertLoadingSection(detailPage: Element): HTMLElement | null {
  if (detailPage.querySelector('.buyflow-products-v2-section')) return null;
  const orderSection = detailPage.querySelector(':scope > .content-section');
  if (!orderSection) return null;

  const section = createSection(`
    <section class="content-section buyflow-products-v2-section" data-buyflow-products="loading">
      ${loadingHtml()}
    </section>
  `);
  if (!section) return null;
  orderSection.insertAdjacentElement('afterend', section);
  return section;
}

function bindProductActions(section: HTMLElement, purchaseId: string) {
  section.querySelectorAll<HTMLButtonElement>('[data-hide-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const productId = button.dataset.hideProduct;
      if (!productId) return;
      if (!window.confirm('Biztosan eltávolítod ezt a terméket? A BuyFlow később sem fogja automatikusan visszatenni.')) return;

      button.disabled = true;
      button.textContent = 'Eltávolítás…';
      try {
        await hideProduct(productId);
        const data = await loadVisibleProducts(purchaseId);
        if (!section.isConnected || selectedPurchaseId !== purchaseId) return;
        const replacement = createSection(sectionHtml(data));
        if (replacement) {
          section.replaceWith(replacement);
          bindProductActions(replacement, purchaseId);
        }
      } catch {
        button.disabled = false;
        button.textContent = 'Eltávolítás';
        window.alert('A terméket most nem sikerült eltávolítani. Próbáld újra.');
      }
    });
  });
}

async function renderProductsForCurrentDetail() {
  const detailPage = document.querySelector('.detail-page');
  if (!detailPage || !selectedPurchaseId) return;
  if (detailPage.querySelector('[data-buyflow-products="ready"]')) return;
  if (loadingPurchaseId === selectedPurchaseId) return;

  const target = detailPage.querySelector<HTMLElement>('.buyflow-products-v2-section')
    ?? insertLoadingSection(detailPage);
  if (!target) return;

  const purchaseId = selectedPurchaseId;
  loadingPurchaseId = purchaseId;

  try {
    const data = await loadVisibleProducts(purchaseId);
    if (selectedPurchaseId !== purchaseId || !target.isConnected) return;

    const replacement = createSection(sectionHtml(data));
    if (replacement) {
      target.replaceWith(replacement);
      bindProductActions(replacement, purchaseId);
    }
  } catch {
    if (target.isConnected) {
      target.dataset.buyflowProducts = 'ready';
      target.innerHTML = `
        <div class="section-head"><div><p class="eyebrow">TERMÉKEK</p><h2>Rendelés tartalma</h2></div></div>
        <div class="detail-empty">A termékadatokat most nem sikerült betölteni.</div>
      `;
    }
  } finally {
    if (loadingPurchaseId === purchaseId) loadingPurchaseId = null;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-purchase-id]')
    : null;
  const purchaseId = target?.dataset.purchaseId;
  if (purchaseId) selectedPurchaseId = purchaseId;
}, true);

const observer = new MutationObserver(() => {
  void renderProductsForCurrentDetail();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
