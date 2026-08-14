export const USER_OVERRIDE_PROVIDER = 'buyflow_user';
export const USER_OVERRIDE_MODEL = 'manual_override';
export const USER_OVERRIDE_VERSION = 'user-product-override-v1';

export interface UserProductOverrideRun {
  purchase_id: string;
  result: unknown;
  created_at?: string;
}

type ProductRow = Record<string, unknown> & {
  id: string;
  purchase_id: string;
  source_key?: string | null;
};

const EDITABLE_DB_FIELDS = new Set([
  'name',
  'brand',
  'model',
  'variant',
  'sku',
  'gtin',
  'category',
  'quantity',
  'unit_price',
  'total_price',
  'currency',
  'product_url',
  'image_url',
]);

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizedStoredChanges(value: unknown): Record<string, unknown> {
  const input = objectOrNull(value);
  if (!input) return {};

  const changes: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(input)) {
    if (!EDITABLE_DB_FIELDS.has(key)) continue;
    if (
      fieldValue === null ||
      typeof fieldValue === 'string' ||
      (typeof fieldValue === 'number' && Number.isFinite(fieldValue))
    ) {
      changes[key] = fieldValue;
    }
  }
  return changes;
}

function overrideMatchesProduct(result: Record<string, unknown>, product: ProductRow): boolean {
  if (result.product_id === product.id) return true;
  return Boolean(
    product.source_key &&
    typeof result.source_key === 'string' &&
    result.source_key === product.source_key,
  );
}

export function applyUserProductOverrides<T extends ProductRow>(
  products: T[],
  overrideRuns: UserProductOverrideRun[],
): T[] {
  return products.flatMap((product) => {
    let hidden = false;
    let visibleProduct: ProductRow = { ...product };

    for (const run of overrideRuns) {
      if (run.purchase_id !== product.purchase_id) continue;
      const result = objectOrNull(run.result);
      if (!result || !overrideMatchesProduct(result, product)) continue;

      if (result.action === 'hide_product') {
        hidden = true;
        continue;
      }

      if (result.action === 'edit_product') {
        visibleProduct = {
          ...visibleProduct,
          ...sanitizedStoredChanges(result.changes),
        };
      }
    }

    return hidden ? [] : [visibleProduct as T];
  });
}

export async function loadUserProductOverrideRuns(
  db: any,
  userId: string,
  purchaseIds: string[],
): Promise<UserProductOverrideRun[]> {
  if (purchaseIds.length === 0) return [];

  const { data, error } = await db
    .from('ai_processing_runs')
    .select('purchase_id,result,created_at')
    .eq('user_id', userId)
    .eq('purpose', 'other')
    .eq('provider', USER_OVERRIDE_PROVIDER)
    .eq('prompt_version', USER_OVERRIDE_VERSION)
    .in('purchase_id', purchaseIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`User product overrides read failed: ${error.message}`);
  }

  return (data ?? []) as UserProductOverrideRun[];
}
