import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import {
  applyUserProductOverrides,
  loadUserProductOverrideRuns,
  USER_OVERRIDE_MODEL,
  USER_OVERRIDE_PROVIDER,
  USER_OVERRIDE_VERSION,
} from './product-user-overrides.js';

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

function normalizedNullableText(value: unknown, maxLength = 500): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) return undefined;
  return text;
}

function normalizedNullableNumber(
  value: unknown,
  options: { min: number; max: number },
): number | null | undefined {
  if (value === null || value === '') return null;
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < options.min || numeric > options.max) return undefined;
  return numeric;
}

function productEditChanges(body: unknown): Record<string, unknown> | null {
  const input = objectOrNull(body);
  if (!input) return null;

  const changes: Record<string, unknown> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);

  if (has('name')) {
    const name = normalizedNullableText(input.name);
    if (!name) return null;
    changes.name = name;
  }

  for (const key of ['brand', 'model', 'variant', 'sku', 'gtin', 'category'] as const) {
    if (!has(key)) continue;
    const value = normalizedNullableText(input[key]);
    if (value === undefined) return null;
    changes[key] = value;
  }

  if (has('quantity')) {
    const value = normalizedNullableNumber(input.quantity, { min: 0.001, max: 1000 });
    if (value === undefined) return null;
    changes.quantity = value;
  }

  if (has('unitPrice')) {
    const value = normalizedNullableNumber(input.unitPrice, { min: 0, max: 1_000_000_000 });
    if (value === undefined) return null;
    changes.unit_price = value;
  }

  if (has('totalPrice')) {
    const value = normalizedNullableNumber(input.totalPrice, { min: 0, max: 1_000_000_000 });
    if (value === undefined) return null;
    changes.total_price = value;
  }

  if (has('currency')) {
    const value = normalizedNullableText(input.currency, 3);
    if (value === undefined) return null;
    if (value !== null && !/^[A-Za-z]{3}$/.test(value)) return null;
    changes.currency = value?.toUpperCase() ?? null;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

async function ownedProduct(db: any, userId: string, productId: string) {
  const { data: product, error: productError } = await db
    .from('products')
    .select('id,purchase_id,name,brand,model,variant,sku,gtin,category,quantity,unit_price,total_price,currency,product_url,image_url,source_key,created_at,updated_at')
    .eq('id', productId)
    .maybeSingle();
  if (productError) throw new Error(`Product read failed: ${productError.message}`);
  if (!product) return null;

  const { data: purchase, error: purchaseError } = await db
    .from('purchases')
    .select('id')
    .eq('id', product.purchase_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (purchaseError) throw new Error(`Purchase ownership read failed: ${purchaseError.message}`);
  if (!purchase) return null;

  return product;
}

async function insertUserOverride(
  db: any,
  input: {
    userId: string;
    purchaseId: string;
    result: Record<string, unknown>;
  },
) {
  const { error } = await db.from('ai_processing_runs').insert({
    user_id: input.userId,
    source_email_id: null,
    purchase_id: input.purchaseId,
    purpose: 'other',
    provider: USER_OVERRIDE_PROVIDER,
    model: USER_OVERRIDE_MODEL,
    prompt_version: USER_OVERRIDE_VERSION,
    status: 'completed',
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost: 0,
    confidence: 1,
    result: input.result,
  });
  if (error) throw new Error(`User product override insert failed: ${error.message}`);
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
        const overrides = await loadUserProductOverrideRuns(db, user.id, [purchase.id]);
        const products = applyUserProductOverrides(rows ?? [], overrides);
        return {
          products: products.map(publicProduct),
          hiddenCount: (rows ?? []).length - products.length,
        };
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
      try {
        const product = await ownedProduct(db, user.id, request.params.id);
        if (!product) return reply.code(404).send({ error: 'product_not_found' });

        const overrides = await loadUserProductOverrideRuns(db, user.id, [product.purchase_id]);
        const visible = applyUserProductOverrides([product], overrides);
        if (visible.length === 0) {
          return { ok: true, alreadyHidden: true };
        }

        await insertUserOverride(db, {
          userId: user.id,
          purchaseId: product.purchase_id,
          result: {
            action: 'hide_product',
            product_id: product.id,
            source_key: product.source_key ?? null,
            product_name: product.name,
          },
        });
        return { ok: true, alreadyHidden: false };
      } catch (error) {
        request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Failed to save user product hide override');
        return reply.code(500).send({ error: 'product_update_unavailable' });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/products/:id',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      if (!uuid(request.params.id)) {
        return reply.code(400).send({ error: 'invalid_product_id' });
      }

      const changes = productEditChanges(request.body);
      if (!changes) {
        return reply.code(400).send({ error: 'invalid_product_update' });
      }

      const db = getSupabaseAdmin() as any;
      try {
        const product = await ownedProduct(db, user.id, request.params.id);
        if (!product) return reply.code(404).send({ error: 'product_not_found' });

        const overrides = await loadUserProductOverrideRuns(db, user.id, [product.purchase_id]);
        const visible = applyUserProductOverrides([product], overrides);
        const visibleProduct = visible[0];
        if (!visibleProduct) {
          return reply.code(409).send({ error: 'product_hidden' });
        }

        await insertUserOverride(db, {
          userId: user.id,
          purchaseId: product.purchase_id,
          result: {
            action: 'edit_product',
            product_id: product.id,
            source_key: product.source_key ?? null,
            changes,
          },
        });

        return {
          ok: true,
          product: publicProduct({ ...visibleProduct, ...changes }),
        };
      } catch (error) {
        request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Failed to save user product edit override');
        return reply.code(500).send({ error: 'product_update_unavailable' });
      }
    },
  );
}
