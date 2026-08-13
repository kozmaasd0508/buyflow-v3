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

alter table public.products
  add column if not exists suppressed_by_user boolean not null default false,
  add column if not exists suppressed_at timestamptz;

create index if not exists idx_products_visible_purchase
  on public.products(purchase_id, created_at)
  where suppressed_by_user = false;

-- This is intentionally a soft deletion. AI enrichment never writes either
-- suppression column, so an upsert can refresh evidence but cannot make a
-- user-deleted product visible again.
