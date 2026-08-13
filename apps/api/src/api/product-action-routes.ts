import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const USER_OVERRIDE_PROVIDER = 'buyflow_user';
const USER_OVERRIDE_MODEL = 'manual_override';
const USER_OVERRIDE_VERSION = 'user-product-override-v1';

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

async function hiddenProductKeys(db: any, userId: string, purchaseId: string) {
  const { data, error } = await db
    .from('ai_processing_runs')
    .select('output_json')
    .eq('user_id', userId)
    .eq('purchase_id', purchaseId)
    .eq('purpose', 'other')
    .eq('provider', USER_OVERRIDE_PROVIDER)
    .eq('prompt_version', USER_OVERRIDE_VERSION)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`User product overrides read failed: ${error.message}`);

  const ids = new Set<string>();
  const sourceKeys = new Set<string>();
  for (const row of data ?? []) {
    const result = objectOrNull(row.output_json);
    if (result?.action !== 'hide_product') continue;
    if (typeof result.product_id === 'string') ids.add(result.product_id);
    if (typeof result.source_key === 'string' && result.source_key) sourceKeys.add(result.source_key);
  }
  return { ids, sourceKeys };
}

export async function registerProductActionRoutes(app: FastifyInstance) {
  app.get<{ Params: { purchaseId: string } }>(
    '/api/purchases/:purchaseId/visible-products',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      if (!uuid(request.params.purchaseId)) {
        return reply.code(400).send({ error: 'invalid_purchase_id' });
      }

      const db = getSupabaseAdmin() as any;
      const { data: purchase, error: purchaseError } = await db
        .from('purchases')
        .select('id')
        .eq('id', request.params.purchaseId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (purchaseError) return reply.code(500).send({ error: 'products_unavailable' });
      if (!purchase) return reply.code(404).send({ error: 'purchase_not_found' });

      const { data: rows, error: productsError } = await db
        .from('products')
        .select('id,purchase_id,name,brand,model,variant,sku,gtin,category,quantity,unit_price,total_price,currency,product_url,image_url,source_key,created_at,updated_at')
        .eq('purchase_id', purchase.id)
        .order('created_at', { ascending: true });
      if (productsError) return reply.code(500).send({ error: 'products_unavailable' });

      try {
        const hidden = await hiddenProductKeys(db, user.id, purchase.id);
        const products = (rows ?? []).filter((row: any) =>
          !hidden.ids.has(row.id) &&
          !(typeof row.source_key === 'string' && hidden.sourceKeys.has(row.source_key)),
        );
        return { products: products.map(publicProduct), hiddenCount: (rows ?? []).length - products.length };
      } catch (error) {
        request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Failed to apply user product overrides');
        return reply.code(500).send({ error: 'products_unavailable' });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/products/:id/hide',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      if (!uuid(request.params.id)) {
        return reply.code(400).send({ error: 'invalid_product_id' });
      }

      const db = getSupabaseAdmin() as any;
      const { data: product, error: productError } = await db
        .from('products')
        .select('id,purchase_id,name,source_key')
        .eq('id', request.params.id)
        .maybeSingle();
      if (productError) return reply.code(500).send({ error: 'product_update_unavailable' });
      if (!product) return reply.code(404).send({ error: 'product_not_found' });

      const { data: purchase, error: purchaseError } = await db
        .from('purchases')
        .select('id')
        .eq('id', product.purchase_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (purchaseError) return reply.code(500).send({ error: 'product_update_unavailable' });
      if (!purchase) return reply.code(404).send({ error: 'product_not_found' });

      try {
        const hidden = await hiddenProductKeys(db, user.id, product.purchase_id);
        if (hidden.ids.has(product.id) || (product.source_key && hidden.sourceKeys.has(product.source_key))) {
          return { ok: true, alreadyHidden: true };
        }

        const { error: insertError } = await db.from('ai_processing_runs').insert({
          user_id: user.id,
          source_email_id: null,
          purchase_id: product.purchase_id,
          purpose: 'other',
          provider: USER_OVERRIDE_PROVIDER,
          model: USER_OVERRIDE_MODEL,
          prompt_version: USER_OVERRIDE_VERSION,
          status: 'completed',
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          confidence: 1,
          output_json: {
            action: 'hide_product',
            product_id: product.id,
            source_key: product.source_key ?? null,
            product_name: product.name,
          },
        });
        if (insertError) throw new Error(insertError.message);
        return { ok: true, alreadyHidden: false };
      } catch (error) {
        request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Failed to save user product override');
        return reply.code(500).send({ error: 'product_update_unavailable' });
      }
    },
  );
}
