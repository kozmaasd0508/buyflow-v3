import {
  hideProduct,
  loadPurchase,
  updateProduct,
  type ProductSummary,
  type ProductUpdate,
} from './api.js';
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

function formValue(value: number | string | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function editInput(
  name: string,
  label: string,
  value: number | string | null | undefined,
  options: { type?: 'text' | 'number'; required?: boolean; step?: string; inputmode?: string } = {},
): string {
  const original = formValue(value);
  return `
    <label class="buyflow-product-edit-field">
      <span>${escapeHtml(label)}</span>
      <input
        name="${escapeHtml(name)}"
        type="${options.type ?? 'text'}"
        value="${escapeHtml(original)}"
        data-original="${escapeHtml(original)}"
        ${options.required ? 'required' : ''}
        ${options.step ? `step="${escapeHtml(options.step)}"` : ''}
        ${options.inputmode ? `inputmode="${escapeHtml(options.inputmode)}"` : ''}
        autocomplete="off"
      />
    </label>
  `;
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
    <article class="buyflow-product-card" data-product-card="${escapeHtml(product.id)}">
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
        <div class="buyflow-product-actions">
          <button type="button" class="buyflow-product-action" data-product-edit="${escapeHtml(product.id)}">Szerkesztés</button>
          <button type="button" class="buyflow-product-action danger" data-product-hide="${escapeHtml(product.id)}">Eltávolítás</button>
        </div>
        <form class="buyflow-product-edit-form" data-product-edit-form="${escapeHtml(product.id)}" hidden>
          <div class="buyflow-product-edit-grid">
            ${editInput('name', 'Termék neve', product.name, { required: true })}
            ${editInput('brand', 'Márka', product.brand)}
            ${editInput('model', 'Modell', product.model)}
            ${editInput('variant', 'Változat', product.variant)}
            ${editInput('quantity', 'Mennyiség', product.quantity, { type: 'number', step: '0.001', inputmode: 'decimal' })}
            ${editInput('unitPrice', 'Egységár', product.unitPrice, { type: 'number', step: '0.01', inputmode: 'decimal' })}
            ${editInput('totalPrice', 'Összesen', product.totalPrice, { type: 'number', step: '0.01', inputmode: 'decimal' })}
            ${editInput('currency', 'Pénznem', product.currency)}
          </div>
          <div class="buyflow-product-edit-buttons">
            <button type="button" class="buyflow-product-edit-cancel">Mégse</button>
            <button type="submit" class="buyflow-product-edit-save">Mentés</button>
          </div>
        </form>
        <p class="buyflow-product-message" aria-live="polite"></p>
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

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_EXPIRED');
  return token;
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
    const token = await accessToken();
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

async function refreshProducts() {
  const section = document.querySelector('.buyflow-products-v2-section');
  section?.remove();
  await renderProductsForCurrentDetail();
}

function productCardFor(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[data-product-card]');
}

function setProductMessage(card: HTMLElement, message: string, type: 'normal' | 'error' = 'normal') {
  const target = card.querySelector<HTMLElement>('.buyflow-product-message');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('is-error', type === 'error');
}

function setProductBusy(card: HTMLElement, busy: boolean) {
  card.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = busy;
  });
  card.classList.toggle('is-busy', busy);
}

function input(form: HTMLFormElement, name: string): HTMLInputElement | null {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLInputElement ? control : null;
}

function changedText(
  control: HTMLInputElement,
  options: { required?: boolean; uppercase?: boolean } = {},
): string | null | undefined {
  let current = control.value.trim();
  if (options.uppercase) current = current.toUpperCase();
  let original = control.dataset.original?.trim() ?? '';
  if (options.uppercase) original = original.toUpperCase();
  if (current === original) return undefined;
  if (options.required && !current) throw new Error('A termék neve nem lehet üres.');
  return current || null;
}

function changedNumber(control: HTMLInputElement): number | null | undefined {
  const currentText = control.value.trim().replace(',', '.');
  const originalText = control.dataset.original?.trim().replace(',', '.') ?? '';
  if (currentText === originalText) return undefined;
  if (!currentText) return null;
  const value = Number(currentText);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Az ár és a mennyiség csak érvényes, nem negatív szám lehet.');
  }
  return value;
}

function productChanges(form: HTMLFormElement): ProductUpdate {
  const changes: ProductUpdate = {};

  const name = input(form, 'name');
  const brand = input(form, 'brand');
  const model = input(form, 'model');
  const variant = input(form, 'variant');
  const quantity = input(form, 'quantity');
  const unitPrice = input(form, 'unitPrice');
  const totalPrice = input(form, 'totalPrice');
  const currency = input(form, 'currency');
  if (!name || !brand || !model || !variant || !quantity || !unitPrice || !totalPrice || !currency) {
    throw new Error('A szerkesztő űrlap hiányos.');
  }

  const nameValue = changedText(name, { required: true });
  const brandValue = changedText(brand);
  const modelValue = changedText(model);
  const variantValue = changedText(variant);
  const quantityValue = changedNumber(quantity);
  const unitPriceValue = changedNumber(unitPrice);
  const totalPriceValue = changedNumber(totalPrice);
  const currencyValue = changedText(currency, { uppercase: true });

  if (nameValue !== undefined) changes.name = nameValue ?? '';
  if (brandValue !== undefined) changes.brand = brandValue;
  if (modelValue !== undefined) changes.model = modelValue;
  if (variantValue !== undefined) changes.variant = variantValue;
  if (quantityValue !== undefined) changes.quantity = quantityValue;
  if (unitPriceValue !== undefined) changes.unitPrice = unitPriceValue;
  if (totalPriceValue !== undefined) changes.totalPrice = totalPriceValue;
  if (currencyValue !== undefined) {
    if (currencyValue !== null && !/^[A-Z]{3}$/.test(currencyValue)) {
      throw new Error('A pénznem 3 betűs kód legyen, például HUF vagy EUR.');
    }
    changes.currency = currencyValue;
  }

  return changes;
}

document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : null;
  if (!clicked) return;

  const purchaseTarget = clicked.closest<HTMLElement>('[data-purchase-id]');
  const purchaseId = purchaseTarget?.dataset.purchaseId;
  if (purchaseId) selectedPurchaseId = purchaseId;

  const editButton = clicked.closest<HTMLButtonElement>('[data-product-edit]');
  if (editButton) {
    const card = productCardFor(editButton);
    const form = card?.querySelector<HTMLFormElement>('[data-product-edit-form]');
    if (card && form) {
      const willOpen = form.hidden;
      card.querySelectorAll<HTMLFormElement>('[data-product-edit-form]').forEach((candidate) => {
        candidate.hidden = true;
      });
      form.hidden = !willOpen;
      setProductMessage(card, '');
      if (willOpen) input(form, 'name')?.focus();
    }
    return;
  }

  const cancelButton = clicked.closest<HTMLButtonElement>('.buyflow-product-edit-cancel');
  if (cancelButton) {
    const form = cancelButton.closest<HTMLFormElement>('[data-product-edit-form]');
    form?.reset();
    if (form) form.hidden = true;
    const card = productCardFor(cancelButton);
    if (card) setProductMessage(card, '');
    return;
  }

  const hideButton = clicked.closest<HTMLButtonElement>('[data-product-hide]');
  if (hideButton) {
    const productId = hideButton.dataset.productHide;
    const card = productCardFor(hideButton);
    if (!productId || !card) return;
    if (!window.confirm('Eltávolítod ezt a terméket a BuyFlow rendelésből? Az eredeti email nem törlődik.')) return;

    setProductBusy(card, true);
    setProductMessage(card, 'Eltávolítás…');
    void (async () => {
      try {
        const token = await accessToken();
        await hideProduct(token, productId);
        await refreshProducts();
      } catch {
        setProductBusy(card, false);
        setProductMessage(card, 'Nem sikerült eltávolítani a terméket. Próbáld újra.', 'error');
      }
    })();
  }
}, true);

document.addEventListener('submit', (event) => {
  const form = event.target instanceof HTMLFormElement
    ? event.target.closest<HTMLFormElement>('[data-product-edit-form]')
    : null;
  if (!form) return;
  event.preventDefault();

  const productId = form.dataset.productEditForm;
  const card = productCardFor(form);
  if (!productId || !card) return;

  let changes: ProductUpdate;
  try {
    changes = productChanges(form);
  } catch (error) {
    setProductMessage(card, error instanceof Error ? error.message : 'Ellenőrizd a megadott adatokat.', 'error');
    return;
  }

  if (Object.keys(changes).length === 0) {
    form.hidden = true;
    setProductMessage(card, 'Nem változott semmi.');
    return;
  }

  setProductBusy(card, true);
  setProductMessage(card, 'Mentés…');
  void (async () => {
    try {
      const token = await accessToken();
      await updateProduct(token, productId, changes);
      await refreshProducts();
    } catch {
      setProductBusy(card, false);
      setProductMessage(card, 'Nem sikerült elmenteni a módosítást. Próbáld újra.', 'error');
    }
  })();
});

const observer = new MutationObserver(() => {
  void renderProductsForCurrentDetail();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
