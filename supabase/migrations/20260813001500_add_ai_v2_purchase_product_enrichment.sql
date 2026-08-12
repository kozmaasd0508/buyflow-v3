alter table public.purchases
  add column if not exists merchant_legal_name text,
  add column if not exists shipping_method text,
  add column if not exists expected_carrier text;

alter table public.products
  add column if not exists product_url text,
  add column if not exists source_email_id uuid references public.source_emails(id) on delete set null,
  add column if not exists source_confidence numeric(5,4),
  add column if not exists source_key text;

alter table public.products alter column quantity drop not null;

alter table public.products
  drop constraint if exists products_source_confidence_check;
alter table public.products
  add constraint products_source_confidence_check
  check (source_confidence is null or (source_confidence >= 0 and source_confidence <= 1));

create unique index if not exists uq_products_purchase_source_key
  on public.products(purchase_id, source_key)
  where source_key is not null;

create index if not exists idx_products_source_email
  on public.products(source_email_id);

create or replace function public.controlled_enrich_purchase_from_order_source(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_order jsonb,
  p_products jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validation_status text;
  v_validated_result jsonb;
  v_received_at timestamptz;
  v_purchase_order_number text;
  v_product record;
  v_source_key text;
  v_count integer := 0;
  v_currency text;
  v_payment_status text;
  v_total numeric;
  v_subtotal numeric;
  v_shipping numeric;
  v_discount numeric;
begin
  if p_user_id is null or p_purchase_id is null or p_source_email_id is null then
    raise exception 'purchase enrichment identity is incomplete';
  end if;

  if jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object' then
    raise exception 'order payload must be an object';
  end if;
  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) <> 'array' then
    raise exception 'products payload must be an array';
  end if;
  if jsonb_array_length(coalesce(p_products, '[]'::jsonb)) > 50 then
    raise exception 'too many products in one source email';
  end if;

  select se.validation_status, se.validated_result, se.received_at
    into v_validation_status, v_validated_result, v_received_at
  from public.source_emails se
  where se.id = p_source_email_id
    and se.user_id = p_user_id;

  if v_validated_result is null then
    raise exception 'source email has no validated extraction';
  end if;
  if coalesce(v_validated_result->>'validation_status', v_validation_status) not in ('validated','guardrailed') then
    raise exception 'source email is not trusted';
  end if;
  if v_validated_result->>'event_type' <> 'order_created' then
    raise exception 'products may only be created from an order_created source';
  end if;

  select p.order_number into v_purchase_order_number
  from public.purchases p
  where p.id = p_purchase_id and p.user_id = p_user_id;
  if not found then
    raise exception 'purchase does not belong to target user';
  end if;

  if not exists (
    select 1 from public.purchase_sources ps
    where ps.purchase_id = p_purchase_id
      and ps.source_email_id = p_source_email_id
  ) then
    raise exception 'order source is not linked to purchase';
  end if;

  if nullif(btrim(p_order->>'order_number'), '') is not null
     and lower(btrim(p_order->>'order_number')) <> lower(coalesce(btrim(v_purchase_order_number), '')) then
    raise exception 'order number does not match purchase';
  end if;

  v_currency := upper(nullif(btrim(p_order->>'currency'), ''));
  if v_currency is not null and v_currency !~ '^[A-Z]{3}$' then
    v_currency := null;
  end if;

  v_payment_status := lower(nullif(btrim(p_order->>'payment_status'), ''));
  if v_payment_status not in ('paid','pending','unpaid','failed','refunded','cash_on_delivery','unknown') then
    v_payment_status := null;
  end if;

  if jsonb_typeof(p_order->'total') = 'number' then v_total := (p_order->>'total')::numeric; end if;
  if jsonb_typeof(p_order->'subtotal') = 'number' then v_subtotal := (p_order->>'subtotal')::numeric; end if;
  if jsonb_typeof(p_order->'shipping_amount') = 'number' then v_shipping := (p_order->>'shipping_amount')::numeric; end if;
  if jsonb_typeof(p_order->'discount_amount') = 'number' then v_discount := (p_order->>'discount_amount')::numeric; end if;

  if v_total is not null and v_total < 0 then v_total := null; end if;
  if v_subtotal is not null and v_subtotal < 0 then v_subtotal := null; end if;
  if v_shipping is not null and v_shipping < 0 then v_shipping := null; end if;
  if v_discount is not null and v_discount < 0 then v_discount := null; end if;

  update public.purchases
  set merchant_legal_name = coalesce(nullif(btrim(p_order->>'merchant_legal_name'), ''), merchant_legal_name),
      subtotal = coalesce(v_subtotal, subtotal),
      shipping_amount = coalesce(v_shipping, shipping_amount),
      discount_amount = coalesce(v_discount, discount_amount),
      total_amount = coalesce(v_total, total_amount),
      currency = coalesce(v_currency, currency),
      payment_method = coalesce(nullif(btrim(p_order->>'payment_method'), ''), payment_method),
      payment_status = coalesce(v_payment_status, payment_status),
      shipping_method = coalesce(nullif(btrim(p_order->>'shipping_method'), ''), shipping_method),
      expected_carrier = coalesce(nullif(btrim(p_order->>'carrier'), ''), expected_carrier),
      paid_at = case
        when v_payment_status = 'paid' then coalesce(paid_at, v_received_at)
        else paid_at
      end
  where id = p_purchase_id and user_id = p_user_id;

  for v_product in
    select * from jsonb_to_recordset(coalesce(p_products, '[]'::jsonb)) as x(
      name text,
      brand text,
      model text,
      variant text,
      sku text,
      gtin text,
      category text,
      quantity numeric,
      unit_price numeric,
      total_price numeric,
      currency text,
      product_url text,
      image_url text,
      confidence numeric
    )
  loop
    if nullif(btrim(v_product.name), '') is null then
      continue;
    end if;
    if char_length(btrim(v_product.name)) > 500 then
      continue;
    end if;
    if v_product.quantity is not null and (v_product.quantity <= 0 or v_product.quantity > 1000) then
      continue;
    end if;
    if v_product.unit_price is not null and v_product.unit_price < 0 then
      continue;
    end if;
    if v_product.total_price is not null and v_product.total_price < 0 then
      continue;
    end if;
    if v_product.confidence is not null and (v_product.confidence < 0 or v_product.confidence > 1) then
      continue;
    end if;

    v_source_key := case
      when nullif(btrim(v_product.sku), '') is not null
        then 'sku:' || lower(btrim(v_product.sku))
      when nullif(btrim(v_product.gtin), '') is not null
        then 'gtin:' || lower(btrim(v_product.gtin))
      else 'name:' || lower(regexp_replace(btrim(v_product.name), '\s+', ' ', 'g'))
        || '|variant:' || lower(coalesce(nullif(btrim(v_product.variant), ''), ''))
    end;

    insert into public.products (
      purchase_id, name, brand, model, variant, sku, gtin, category,
      quantity, unit_price, total_price, currency, product_url, image_url,
      source_email_id, source_confidence, source_key
    ) values (
      p_purchase_id,
      btrim(v_product.name),
      nullif(btrim(v_product.brand), ''),
      nullif(btrim(v_product.model), ''),
      nullif(btrim(v_product.variant), ''),
      nullif(btrim(v_product.sku), ''),
      nullif(btrim(v_product.gtin), ''),
      nullif(btrim(v_product.category), ''),
      v_product.quantity,
      v_product.unit_price,
      v_product.total_price,
      case when upper(coalesce(v_product.currency, '')) ~ '^[A-Z]{3}$' then upper(v_product.currency) else null end,
      case when coalesce(v_product.product_url, '') ~* '^https?://' then v_product.product_url else null end,
      case when coalesce(v_product.image_url, '') ~* '^https?://' then v_product.image_url else null end,
      p_source_email_id,
      v_product.confidence,
      v_source_key
    )
    on conflict (purchase_id, source_key) where source_key is not null
    do update set
      name = excluded.name,
      brand = coalesce(excluded.brand, products.brand),
      model = coalesce(excluded.model, products.model),
      variant = coalesce(excluded.variant, products.variant),
      sku = coalesce(excluded.sku, products.sku),
      gtin = coalesce(excluded.gtin, products.gtin),
      category = coalesce(excluded.category, products.category),
      quantity = coalesce(excluded.quantity, products.quantity),
      unit_price = coalesce(excluded.unit_price, products.unit_price),
      total_price = coalesce(excluded.total_price, products.total_price),
      currency = coalesce(excluded.currency, products.currency),
      product_url = coalesce(excluded.product_url, products.product_url),
      image_url = coalesce(excluded.image_url, products.image_url),
      source_email_id = excluded.source_email_id,
      source_confidence = greatest(coalesce(products.source_confidence, 0), coalesce(excluded.source_confidence, 0));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.controlled_apply_payment_evidence(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_payment jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validation_status text;
  v_validated_result jsonb;
  v_received_at timestamptz;
  v_purchase_order_number text;
  v_paid_amount numeric;
  v_paid_currency text;
  v_payment_status text;
begin
  select se.validation_status, se.validated_result, se.received_at
    into v_validation_status, v_validated_result, v_received_at
  from public.source_emails se
  where se.id = p_source_email_id and se.user_id = p_user_id;

  if v_validated_result is null
     or coalesce(v_validated_result->>'validation_status', v_validation_status) not in ('validated','guardrailed')
     or v_validated_result->>'event_type' <> 'payment_completed' then
    raise exception 'payment source is not trusted payment evidence';
  end if;

  select p.order_number into v_purchase_order_number
  from public.purchases p
  where p.id = p_purchase_id and p.user_id = p_user_id;
  if not found then raise exception 'purchase does not belong to target user'; end if;

  if not exists (
    select 1 from public.purchase_sources ps
    where ps.purchase_id = p_purchase_id and ps.source_email_id = p_source_email_id
  ) then
    raise exception 'payment source is not linked to purchase';
  end if;

  if nullif(btrim(p_payment->>'order_number'), '') is not null
     and lower(btrim(p_payment->>'order_number')) <> lower(coalesce(btrim(v_purchase_order_number), '')) then
    raise exception 'payment order number does not match purchase';
  end if;

  if jsonb_typeof(p_payment->'paid_amount') = 'number' then
    v_paid_amount := (p_payment->>'paid_amount')::numeric;
    if v_paid_amount < 0 then v_paid_amount := null; end if;
  end if;
  v_paid_currency := upper(nullif(btrim(p_payment->>'paid_currency'), ''));
  if v_paid_currency is not null and v_paid_currency !~ '^[A-Z]{3}$' then v_paid_currency := null; end if;
  v_payment_status := lower(nullif(btrim(p_payment->>'payment_status'), ''));
  if v_payment_status not in ('paid','pending','unpaid','failed','refunded','cash_on_delivery','unknown') then
    v_payment_status := null;
  end if;

  update public.purchases
  set payment_method = coalesce(nullif(btrim(p_payment->>'payment_method'), ''), payment_method),
      payment_status = coalesce(v_payment_status, payment_status),
      total_amount = coalesce(total_amount, v_paid_amount),
      currency = coalesce(currency, v_paid_currency),
      paid_at = case when v_payment_status = 'paid' then coalesce(paid_at, v_received_at) else paid_at end
  where id = p_purchase_id and user_id = p_user_id;
end;
$$;

revoke all on function public.controlled_enrich_purchase_from_order_source(uuid,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.controlled_enrich_purchase_from_order_source(uuid,uuid,uuid,jsonb,jsonb) to service_role;
revoke all on function public.controlled_apply_payment_evidence(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.controlled_apply_payment_evidence(uuid,uuid,uuid,jsonb) to service_role;
