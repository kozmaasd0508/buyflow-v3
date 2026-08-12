import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { resolveAuthenticatedApiUser } from './auth.js';

function publicPurchase(row: any) {
  return {
    id: row.id,
    merchantName: row.merchant_name,
    merchantLegalName: row.merchant_legal_name,
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
    purchaseDate: row.purchase_date,
    totalAmount: row.total_amount,
    currency: row.currency,
    paymentStatus: row.payment_status,
    currentState: row.current_state,
    orderedAt: row.ordered_at,
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicProduct(row: any) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    model: row.model,
    variant: row.variant,
    sku: row.sku,
    gtin: row.gtin,
    category: row.category,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    totalPrice: row.total_price,
    currency: row.currency,
    productUrl: row.product_url,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicShipment(row: any) {
  return {
    id: row.id,
    carrier: row.carrier,
    carrierSlug: row.carrier_slug,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    status: row.status,
    shippedAt: row.shipped_at,
    estimatedDeliveryAt: row.estimated_delivery_at,
    deliveredAt: row.delivered_at,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDocument(row: any) {
  return {
    id: row.id,
    type: row.type,
    documentNumber: row.document_number,
    issuedAt: row.issued_at,
    sourceType: row.source_type,
    externalUrl: row.external_url,
    filename: row.filename,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function safeLimit(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 50;
  return Math.max(1, Math.min(100, Number(value)));
}

export async function registerAppApiRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    return {
      user: {
        id: user.id,
        email: user.email,
      },
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/purchases', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const supabase = getSupabaseAdmin() as any;
    const limit = safeLimit(request.query.limit);

    const { data: purchaseRows, error: purchaseError } = await supabase
      .from('purchases')
      .select('id,merchant_name,merchant_legal_name,merchant_domain,order_number,purchase_date,total_amount,currency,payment_status,current_state,ordered_at,shipped_at,delivered_at,created_at,updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (purchaseError) {
      request.log.error({ errorType: 'PurchaseListReadError' }, 'Failed to load purchase list');
      return reply.code(500).send({ error: 'purchase_list_unavailable' });
    }

    const purchases = purchaseRows ?? [];
    const purchaseIds = purchases.map((row: any) => row.id);

    let shipmentRows: any[] = [];
    let documentRows: any[] = [];
    let productRows: any[] = [];

    if (purchaseIds.length > 0) {
      const [shipmentResult, documentResult, productResult] = await Promise.all([
        supabase
          .from('shipments')
          .select('id,purchase_id,carrier,carrier_slug,tracking_number,tracking_url,status,shipped_at,estimated_delivery_at,delivered_at,last_event_at,created_at,updated_at')
          .eq('user_id', user.id)
          .in('purchase_id', purchaseIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('documents')
          .select('id,purchase_id,type,document_number,issued_at,source_type,external_url,filename,mime_type,created_at')
          .in('purchase_id', purchaseIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('products')
          .select('id,purchase_id,name')
          .in('purchase_id', purchaseIds)
          .order('created_at', { ascending: true }),
      ]);

      if (shipmentResult.error || documentResult.error || productResult.error) {
        request.log.error({ errorType: 'PurchaseListChildReadError' }, 'Failed to load purchase list children');
        return reply.code(500).send({ error: 'purchase_list_unavailable' });
      }

      shipmentRows = shipmentResult.data ?? [];
      documentRows = documentResult.data ?? [];
      productRows = productResult.data ?? [];
    }

    return {
      purchases: purchases.map((purchase: any) => {
        const shipments = shipmentRows.filter((row) => row.purchase_id === purchase.id);
        const documents = documentRows.filter((row) => row.purchase_id === purchase.id);
        const products = productRows.filter((row) => row.purchase_id === purchase.id);
        return {
          ...publicPurchase(purchase),
          shipments: shipments.map(publicShipment),
          documentCount: documents.length,
          productCount: products.length,
          productPreview: products.slice(0, 2).map((row) => row.name),
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/purchases/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const purchaseId = request.params.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaseId)) {
      return reply.code(400).send({ error: 'invalid_purchase_id' });
    }

    const supabase = getSupabaseAdmin() as any;
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id,merchant_name,merchant_legal_name,merchant_domain,order_number,purchase_date,subtotal,shipping_amount,discount_amount,total_amount,currency,payment_method,payment_status,shipping_method,expected_carrier,current_state,ordered_at,paid_at,shipped_at,delivered_at,cancelled_at,created_at,updated_at')
      .eq('id', purchaseId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (purchaseError) {
      request.log.error({ errorType: 'PurchaseDetailReadError' }, 'Failed to load purchase detail');
      return reply.code(500).send({ error: 'purchase_unavailable' });
    }
    if (!purchase) {
      return reply.code(404).send({ error: 'purchase_not_found' });
    }

    const [shipmentResult, documentResult, productResult] = await Promise.all([
      supabase
        .from('shipments')
        .select('id,purchase_id,carrier,carrier_slug,tracking_number,tracking_url,status,shipped_at,estimated_delivery_at,delivered_at,last_event_at,created_at,updated_at')
        .eq('purchase_id', purchaseId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('documents')
        .select('id,purchase_id,type,document_number,issued_at,source_type,external_url,filename,mime_type,created_at')
        .eq('purchase_id', purchaseId)
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('id,purchase_id,name,brand,model,variant,sku,gtin,category,quantity,unit_price,total_price,currency,product_url,image_url,created_at,updated_at')
        .eq('purchase_id', purchaseId)
        .order('created_at', { ascending: true }),
    ]);

    if (shipmentResult.error || documentResult.error || productResult.error) {
      request.log.error({ errorType: 'PurchaseDetailChildReadError' }, 'Failed to load purchase detail children');
      return reply.code(500).send({ error: 'purchase_unavailable' });
    }

    return {
      purchase: {
        ...publicPurchase(purchase),
        subtotal: purchase.subtotal,
        shippingAmount: purchase.shipping_amount,
        discountAmount: purchase.discount_amount,
        paymentMethod: purchase.payment_method,
        shippingMethod: purchase.shipping_method,
        expectedCarrier: purchase.expected_carrier,
        paidAt: purchase.paid_at,
        cancelledAt: purchase.cancelled_at,
        products: (productResult.data ?? []).map(publicProduct),
        shipments: (shipmentResult.data ?? []).map(publicShipment),
        documents: (documentResult.data ?? []).map(publicDocument),
      },
    };
  });
}
