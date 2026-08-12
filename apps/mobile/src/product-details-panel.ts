import { loadPurchase, type ProductSummary } from './api.js';
import { supabase } from './supabase.js';
import './product-details-panel.css';

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
    <article class="buyflow-product-card">
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
          ${productUrl ? `<a href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">Termék megnyitása</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function sectionHtml(products: ProductSummary[]): string {
  const body = products.length > 0
    ? `<div class="buyflow-products-grid">${products.map(productCard).join('')}</div>`
    : `<div class="detail-empty">A rendelési emailből még nincs eltárolt termékadat.</div>`;

  return `
    <section class="content-section buyflow-products-v2-section" data-buyflow-products="ready">
      <div class="section-head">
        <div>
          <p class="eyebrow">TERMÉKEK</p>
          <h2>${products.length > 0 ? `${products.length} termék a rendelésben` : 'Termékek'}</h2>
        </div>
      </div>
      ${body}
    </section>
  `;
}

function insertLoadingSection(detailPage: Element): HTMLElement | null {
  if (detailPage.querySelector('.buyflow-products-v2-section')) return null;
  const orderSection = detailPage.querySelector(':scope > .content-section');
  if (!orderSection) return null;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <section class="content-section buyflow-products-v2-section" data-buyflow-products="loading">
      <div class="section-head"><div><p class="eyebrow">TERMÉKEK</p><h2>Rendelés tartalma</h2></div></div>
      <div class="loading-card"><div class="spinner small"></div>Termékadatok betöltése…</div>
    </section>
  `;
  const section = wrapper.firstElementChild as HTMLElement | null;
  if (!section) return null;
  orderSection.insertAdjacentElement('afterend', section);
  return section;
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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('SESSION_EXPIRED');

    const purchase = await loadPurchase(token, purchaseId);
    if (selectedPurchaseId !== purchaseId || !target.isConnected) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = sectionHtml(purchase.products ?? []);
    const replacement = wrapper.firstElementChild;
    if (replacement) target.replaceWith(replacement);
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
