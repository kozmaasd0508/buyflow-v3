import {
  hideProduct,
  loadPurchase,
  updateProduct,
  type ProductSummary,
  type ProductUpdate,
  type PurchaseDetail,
} from './api.js';
import { supabase } from './supabase.js';
import './purchase-detail-overview-panel.css';
import './purchase-timeline-panel.css';
import './product-details-panel.css';
import './mobile-architecture-cleanup-v1.css';

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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Még nincs adat';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Még nincs adat';
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
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
      // Unknown currency codes fall through to a plain safe rendering.
    }
  }
  return `${new Intl.NumberFormat('hu-HU').format(numeric)}${currency ? ` ${escapeHtml(currency)}` : ''}`;
}

function humanState(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    processing: 'Feldolgozás alatt',
    ordered: 'Megrendelve',
    paid: 'Fizetve',
    shipment_created: 'Csomag létrehozva',
    shipped: 'Feladva',
    in_transit: 'Úton van',
    out_for_delivery: 'Ma érkezhet',
    ready_for_pickup: 'Átvehető',
    delivered: 'Kézbesítve',
    delivery_failed: 'Sikertelen kézbesítés',
    delayed: 'Késik',
    cancelled: 'Törölve',
    refunded: 'Visszatérítve',
    review: 'Ellenőrzés alatt',
    pending: 'Függőben',
  };
  return labels[value ?? ''] ?? (value ? value.replaceAll('_', ' ') : 'Ismeretlen');
}

function currentMessage(purchase: PurchaseDetail): { title: string; body: string; tone: string } {
  if (purchase.currentState === 'delivered' || purchase.deliveredAt) {
    return {
      title: 'A rendelés megérkezett',
      body: purchase.documents.length > 0
        ? 'A kézbesítés kész, és a BuyFlow a kapcsolódó dokumentumokat is eltárolta.'
        : 'A kézbesítés kész. Ha később számla vagy garanciaadat érkezik, ugyanitt fog megjelenni.',
      tone: 'success',
    };
  }
  if (purchase.currentState === 'cancelled' || purchase.cancelledAt) {
    return {
      title: 'A rendelés törölve lett',
      body: 'A BuyFlow ezt a vásárlást lezárt, törölt életútként kezeli.',
      tone: 'danger',
    };
  }
  if (purchase.currentState === 'refunded') {
    return {
      title: 'Visszatérítés rögzítve',
      body: 'A BuyFlow visszatérített állapotot lát ennél a vásárlásnál.',
      tone: 'success',
    };
  }
  if (purchase.currentState === 'ready_for_pickup') {
    return {
      title: 'A csomag átvehető',
      body: 'A BuyFlow biztos átvételi eseményt lát ennél a küldeménynél.',
      tone: 'active',
    };
  }
  if (purchase.currentState === 'delayed') {
    return {
      title: 'A csomag késik',
      body: 'A BuyFlow késési eseményt lát. A következő biztos futárfrissítés automatikusan megjelenik.',
      tone: 'warning',
    };
  }
  if (purchase.shipments.length > 0 || purchase.shippedAt || ['shipment_created', 'shipped', 'in_transit', 'out_for_delivery'].includes(purchase.currentState)) {
    const shipment = purchase.shipments[0];
    return {
      title: shipment?.status === 'out_for_delivery' ? 'A csomag ma érkezhet' : 'A csomag úton van',
      body: shipment?.trackingNumber
        ? 'A futáradat és a tracking már össze van kötve a rendeléseddel.'
        : 'A BuyFlow már lát szállítási eseményt, a következő biztos állapotot automatikusan frissíti.',
      tone: 'active',
    };
  }
  if (purchase.paymentStatus === 'paid' || purchase.paidAt) {
    return {
      title: 'Fizetés rendben',
      body: 'A rendelés rögzítve van. Most a biztos feladási vagy futáradatot várjuk.',
      tone: 'active',
    };
  }
  if (purchase.currentState === 'review') {
    return {
      title: 'A BuyFlow még ellenőrzi',
      body: 'A rendelés látható, de egy következő email vagy futáradat még pontosíthatja az állapotát.',
      tone: 'warning',
    };
  }
  return {
    title: 'A rendelés rögzítve van',
    body: 'A következő webshop- vagy futáreseménynél a BuyFlow automatikusan frissíti ezt az oldalt.',
    tone: 'active',
  };
}

function overviewHtml(purchase: PurchaseDetail): string {
  const message = currentMessage(purchase);
  const shipment = purchase.shipments[0];
  const lastActivity = [
    purchase.updatedAt,
    shipment?.lastEventAt,
    purchase.deliveredAt,
    purchase.shippedAt,
    purchase.paidAt,
    purchase.orderedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? purchase.createdAt;
  const carrier = shipment?.carrier || purchase.expectedCarrier || 'Még nincs futár';
  const tracking = shipment?.trackingNumber || 'Még nincs tracking';
  return `
    <section class="buyflow-detail-overview" data-buyflow-detail-overview="ready">
      <article class="buyflow-status-card ${escapeHtml(message.tone)}">
        <div class="buyflow-status-kicker">AKTUÁLIS HELYZET</div>
        <div class="buyflow-status-main">
          <div><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.body)}</p></div>
          <span class="buyflow-status-pill">${escapeHtml(humanState(purchase.currentState))}</span>
        </div>
        <div class="buyflow-status-grid">
          <div><small>Futár</small><strong>${escapeHtml(carrier)}</strong></div>
          <div><small>Tracking</small><strong class="mono">${escapeHtml(tracking)}</strong></div>
          <div><small>Termék</small><strong>${purchase.products.length} db</strong></div>
          <div><small>Dokumentum</small><strong>${purchase.documents.length} db</strong></div>
        </div>
        <div class="buyflow-status-updated">Utolsó biztos frissítés: ${escapeHtml(formatDateTime(lastActivity))}</div>
      </article>
    </section>
  `;
}

type TimelineStatus = 'done' | 'current' | 'future' | 'stopped';
interface TimelineEvent {
  key: string;
  label: string;
  description: string;
  at: string | null;
  status: TimelineStatus;
}

function lifecycleEvents(purchase: PurchaseDetail): TimelineEvent[] {
  const cancelled = Boolean(purchase.cancelledAt || purchase.currentState === 'cancelled');
  const delivered = Boolean(purchase.deliveredAt || purchase.currentState === 'delivered');
  const shipped = Boolean(
    purchase.shippedAt
    || delivered
    || ['shipped', 'in_transit', 'out_for_delivery', 'ready_for_pickup'].includes(purchase.currentState),
  );
  const paid = Boolean(purchase.paidAt || purchase.paymentStatus === 'paid');
  const ordered = Boolean(purchase.orderedAt || purchase.createdAt);

  const events: TimelineEvent[] = [
    {
      key: 'ordered',
      label: 'Rendelés létrejött',
      description: 'A BuyFlow felismerte a vásárlást.',
      at: purchase.orderedAt || purchase.createdAt,
      status: ordered ? 'done' : 'future',
    },
    {
      key: 'paid',
      label: 'Fizetés',
      description: paid ? 'A fizetés sikeresként ismert.' : 'Még nincs biztos sikeres fizetési bizonyíték.',
      at: purchase.paidAt,
      status: paid ? 'done' : cancelled ? 'stopped' : 'future',
    },
    {
      key: 'shipped',
      label: 'Feladva / úton',
      description: shipped ? 'A rendeléshez biztos szállítási esemény tartozik.' : 'Még nincs biztos feladási esemény.',
      at: purchase.shippedAt,
      status: shipped ? 'done' : cancelled ? 'stopped' : 'future',
    },
    {
      key: 'delivered',
      label: 'Kézbesítve',
      description: delivered ? 'A rendelést kézbesítettként ismerjük.' : 'Még nincs kézbesítési bizonyíték.',
      at: purchase.deliveredAt,
      status: delivered ? 'done' : cancelled ? 'stopped' : 'future',
    },
  ];

  if (cancelled) {
    events.push({
      key: 'cancelled',
      label: 'Rendelés törölve',
      description: 'A vásárlási életút törölt állapotban van.',
      at: purchase.cancelledAt,
      status: 'stopped',
    });
  }

  const firstFuture = events.findIndex((event) => event.status === 'future');
  if (firstFuture >= 0 && !cancelled) events[firstFuture]!.status = 'current';
  return events;
}

function timelineHtml(purchase: PurchaseDetail): string {
  const events = lifecycleEvents(purchase);
  return `
    <section class="content-section buyflow-timeline-section" data-buyflow-timeline="ready">
      <div class="section-head">
        <div><p class="eyebrow">VÁSÁRLÁS ÉLETÚTJA</p><h2>Mi történt eddig?</h2></div>
      </div>
      <div class="buyflow-timeline-card">
        ${events.map((event, index) => `
          <div class="buyflow-timeline-row ${event.status}">
            <div class="buyflow-timeline-rail">
              <span class="buyflow-timeline-dot">${event.status === 'done' ? '✓' : event.status === 'stopped' ? '×' : ''}</span>
              ${index < events.length - 1 ? '<span class="buyflow-timeline-line"></span>' : ''}
            </div>
            <div class="buyflow-timeline-copy">
              <div class="buyflow-timeline-title"><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(formatDateTime(event.at))}</span></div>
              <small>${escapeHtml(event.description)}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
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

function productsHtml(products: ProductSummary[]): string {
  const body = products.length > 0
    ? `<div class="buyflow-products-grid">${products.map(productCard).join('')}</div>`
    : '<div class="detail-empty">A rendelési emailből még nincs eltárolt termékadat.</div>';
  return `
    <section class="content-section buyflow-products-v2-section" data-buyflow-products="ready">
      <div class="section-head">
        <div><p class="eyebrow">TERMÉKEK</p><h2>${products.length > 0 ? `${products.length} termék a rendelésben` : 'Termékek'}</h2></div>
      </div>
      ${body}
    </section>
  `;
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

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('SESSION_EXPIRED');
  return token;
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

async function reloadEnhancements(purchaseId: string) {
  const token = await accessToken();
  const purchase = await loadPurchase(token, purchaseId);
  renderPurchaseDetailEnhancements(purchase);
}

function bindProductActions(host: HTMLElement, purchaseId: string) {
  host.querySelectorAll<HTMLButtonElement>('[data-product-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = productCardFor(button);
      const form = card?.querySelector<HTMLFormElement>('[data-product-edit-form]');
      if (!card || !form) return;
      const willOpen = form.hidden;
      host.querySelectorAll<HTMLFormElement>('[data-product-edit-form]').forEach((candidate) => {
        candidate.hidden = true;
      });
      form.hidden = !willOpen;
      setProductMessage(card, '');
      if (willOpen) input(form, 'name')?.focus();
    });
  });

  host.querySelectorAll<HTMLButtonElement>('.buyflow-product-edit-cancel').forEach((button) => {
    button.addEventListener('click', () => {
      const form = button.closest<HTMLFormElement>('[data-product-edit-form]');
      form?.reset();
      if (form) form.hidden = true;
      const card = productCardFor(button);
      if (card) setProductMessage(card, '');
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-product-hide]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.dataset.productHide;
      const card = productCardFor(button);
      if (!productId || !card) return;
      if (!window.confirm('Eltávolítod ezt a terméket a BuyFlow rendelésből? Az eredeti email nem törlődik.')) return;
      setProductBusy(card, true);
      setProductMessage(card, 'Eltávolítás…');
      void (async () => {
        try {
          const token = await accessToken();
          await hideProduct(token, productId);
          await reloadEnhancements(purchaseId);
        } catch {
          setProductBusy(card, false);
          setProductMessage(card, 'Nem sikerült eltávolítani a terméket. Próbáld újra.', 'error');
        }
      })();
    });
  });

  host.querySelectorAll<HTMLFormElement>('[data-product-edit-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
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
          await reloadEnhancements(purchaseId);
        } catch {
          setProductBusy(card, false);
          setProductMessage(card, 'Nem sikerült elmenteni a módosítást. Próbáld újra.', 'error');
        }
      })();
    });
  });
}

export function renderPurchaseDetailEnhancements(purchase: PurchaseDetail): void {
  const host = document.querySelector<HTMLElement>('#purchase-detail-enhancements');
  if (!host) return;
  host.innerHTML = `${overviewHtml(purchase)}${timelineHtml(purchase)}${productsHtml(purchase.products ?? [])}`;
  bindProductActions(host, purchase.id);
}
