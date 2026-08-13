-- BuyFlow V3: configurable audit history + durable user product suppression.

create or replace function public.enqueue_full_audit_email_scan(
  p_user_id uuid,
  p_email_connection_id uuid,
  p_window_days integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_window_days not in (7, 30, 90) then
    raise exception 'full audit supports 7, 30, or 90 days';
  end if;

  if not exists (
    select 1 from public.email_connections
    where id = p_email_connection_id
      and user_id = p_user_id
      and provider = 'nylas'
      and status = 'active'
  ) then
    raise exception 'active email connection not found';
  end if;

  insert into public.email_scan_jobs (
    user_id,
    email_connection_id,
    kind,
    window_days,
    search_term,
    automatic_dedupe_key,
    status,
    attempts,
    next_attempt_at,
    locked_at,
    processed_at,
    last_error_code,
    result
  ) values (
    p_user_id,
    p_email_connection_id,
    'audit',
    p_window_days,
    null,
    null,
    'pending',
    0,
    now(),
    null,
    null,
    null,
    null
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_full_audit_email_scan(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.enqueue_full_audit_email_scan(uuid, uuid, integer) to service_role;

create table if not exists public.product_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  source_key text not null,
  product_snapshot jsonb not null default '{}'::jsonb,
  reason text not null default 'user_deleted',
  created_at timestamptz not null default now(),
  unique (purchase_id, source_key)
);

create index if not exists idx_product_suppressions_user_purchase
  on public.product_suppressions(user_id, purchase_id);

alter table public.product_suppressions enable row level security;

drop policy if exists product_suppressions_own_rows on public.product_suppressions;
create policy product_suppressions_own_rows on public.product_suppressions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- V2 AI products normally already have source_key. Backfill any older rows so
-- a user deletion can still be remembered and block resurrection.
update public.products
set source_key = case
  when nullif(btrim(sku), '') is not null then 'sku:' || lower(btrim(sku))
  when nullif(btrim(gtin), '') is not null then 'gtin:' || lower(btrim(gtin))
  else 'name:' || lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
       || '|variant:' || lower(coalesce(nullif(btrim(variant), ''), ''))
end
where source_key is null;

create or replace function public.prevent_suppressed_product_resurrection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_key is not null and exists (
    select 1
    from public.product_suppressions ps
    where ps.purchase_id = new.purchase_id
      and ps.source_key = new.source_key
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_suppressed_product_resurrection on public.products;
create trigger trg_prevent_suppressed_product_resurrection
before insert on public.products
for each row execute function public.prevent_suppressed_product_resurrection();

create or replace function public.controlled_user_suppress_product(
  p_user_id uuid,
  p_product_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_purchase_user_id uuid;
begin
  select pr.user_id
    into v_purchase_user_id
  from public.products p
  join public.purchases pr on pr.id = p.purchase_id
  where p.id = p_product_id;

  if v_purchase_user_id is null or v_purchase_user_id is distinct from p_user_id then
    return false;
  end if;

  select * into v_product
  from public.products
  where id = p_product_id;

  if v_product.source_key is null then
    return false;
  end if;

  insert into public.product_suppressions (
    user_id,
    purchase_id,
    source_key,
    product_snapshot,
    reason
  ) values (
    p_user_id,
    v_product.purchase_id,
    v_product.source_key,
    jsonb_build_object(
      'name', v_product.name,
      'brand', v_product.brand,
      'model', v_product.model,
      'variant', v_product.variant,
      'sku', v_product.sku,
      'gtin', v_product.gtin,
      'quantity', v_product.quantity,
      'unit_price', v_product.unit_price,
      'total_price', v_product.total_price,
      'currency', v_product.currency,
      'source_email_id', v_product.source_email_id
    ),
    'user_deleted'
  )
  on conflict (purchase_id, source_key) do nothing;

  delete from public.products
  where id = p_product_id
    and purchase_id = v_product.purchase_id;

  return true;
end;
$$;

revoke all on function public.controlled_user_suppress_product(uuid, uuid) from public, anon, authenticated;
grant execute on function public.controlled_user_suppress_product(uuid, uuid) to service_role;
