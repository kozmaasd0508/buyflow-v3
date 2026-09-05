import { mobileConfig } from './config.js';

export interface PurchasePulse {
  status: string;
  label: string;
  title: string;
  body: string;
  tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger';
  movement: boolean;
  delivered: boolean;
  reviewRequired: boolean;
  lastConfirmedAt: string | null;
}

export interface ShipmentSummary {
  id: string;
  carrier: string | null;
  carrierSlug: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  type: string;
  documentNumber: string | null;
  issuedAt: string | null;
  sourceType: string;
  externalUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  variant: string | null;
  sku: string | null;
  gtin: string | null;
  category: string | null;
  quantity: number | string | null;
  unitPrice: number | string | null;
  totalPrice: number | string | null;
  currency: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductUpdate {
  name?: string;
  brand?: string | null;
  model?: string | null;
  variant?: string | null;
  sku?: string | null;
  gtin?: string | null;
  category?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  currency?: string | null;
}

export interface PurchaseSummary {
  id: string;
  merchantName: string | null;
  merchantLegalName: string | null;
  merchantDomain: string | null;
  orderNumber: string | null;
  purchaseDate: string | null;
  totalAmount: number | string | null;
  currency: string | null;
  paymentStatus: string | null;
  currentState: string;
  orderedAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  pulse: PurchasePulse;
  shipments: ShipmentSummary[];
  documentCount: number;
  productCount: number;
  productPreview: string[];
}

export interface PurchaseDetail extends Omit<PurchaseSummary, 'documentCount' | 'productCount' | 'productPreview'> {
  subtotal: number | string | null;
  shippingAmount: number | string | null;
  discountAmount: number | string | null;
  paymentMethod: string | null;
  shippingMethod: string | null;
  expectedCarrier: string | null;
  products: ProductSummary[];
  documents: DocumentSummary[];
}

export interface ShoppingInboxMessage {
  id: string;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string | null;
  classification: string | null;
  processingStatus: string;
  linkedPurchaseId: string | null;
}

export interface ShoppingInboxData {
  assigned: boolean;
  emailAddress: string | null;
  messages: ShoppingInboxMessage[];
}

async function apiRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    throw new Error('SESSION_EXPIRED');
  }

  if (!response.ok) {
    throw new Error(`API_${response.status}`);
  }

  return (await response.json()) as T;
}

export async function loadPurchases(accessToken: string): Promise<PurchaseSummary[]> {
  const data = await apiRequest<{ purchases: PurchaseSummary[] }>('/api/purchases', accessToken);
  return data.purchases;
}

export async function loadPurchase(
  accessToken: string,
  purchaseId: string,
): Promise<PurchaseDetail> {
  const data = await apiRequest<{ purchase: PurchaseDetail }>(
    `/api/purchases/${encodeURIComponent(purchaseId)}`,
    accessToken,
  );
  return data.purchase;
}

export async function loadShoppingInbox(
  accessToken: string,
  limit = 50,
): Promise<ShoppingInboxData> {
  return apiRequest<ShoppingInboxData>(
    `/api/shopping-inbox?limit=${encodeURIComponent(String(limit))}`,
    accessToken,
  );
}

export async function hideProduct(accessToken: string, productId: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/products/${encodeURIComponent(productId)}/hide`,
    accessToken,
    { method: 'POST' },
  );
}

export async function updateProduct(
  accessToken: string,
  productId: string,
  changes: ProductUpdate,
): Promise<ProductSummary> {
  const data = await apiRequest<{ ok: boolean; product: ProductSummary }>(
    `/api/products/${encodeURIComponent(productId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(changes),
    },
  );
  return data.product;
}
