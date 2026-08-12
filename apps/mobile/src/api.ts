import { mobileConfig } from './config.js';

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
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  paidAt: string | null;
  cancelledAt: string | null;
  products: ProductSummary[];
  documents: DocumentSummary[];
}

async function apiRequest<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${mobileConfig.apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
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
