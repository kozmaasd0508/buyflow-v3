create or replace function public.controlled_create_purchase_with_sources(
  p_user_id uuid,
  p_merchant_name text,
  p_merchant_domain text,
  p_order_number text,
  p_ordered_at timestamptz,
  p_confidence numeric,
  p_sources jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_source_count integer;
  v_valid_source_count integer;
begin
  if p_user_id is null or nullif(trim(p_merchant_domain), '') is null or nullif(trim(p_order_number), '') is null then
    raise exception 'purchase identity is incomplete';
  end if;

  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'purchase sources are required';
  end if;

  v_source_count := jsonb_array_length(p_sources);

  select count(*)
    into v_valid_source_count
  from jsonb_to_recordset(p_sources) as x(source_email_id uuid, relation_type text, confidence numeric)
  join public.source_emails se on se.id = x.source_email_id
  where se.user_id = p_user_id;

  if v_valid_source_count <> v_source_count then
    raise exception 'one or more purchase sources do not belong to the target user';
  end if;

  insert into public.purchases (
    user_id,
    merchant_name,
    merchant_domain,
    order_number,
    purchase_date,
    current_state,
    ordered_at,
    confidence
  ) values (
    p_user_id,
    nullif(trim(p_merchant_name), ''),
    lower(trim(p_merchant_domain)),
    trim(p_order_number),
    p_ordered_at::date,
    'processing',
    p_ordered_at,
    p_confidence
  )
  on conflict do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    select id
      into v_purchase_id
    from public.purchases
    where user_id = p_user_id
      and lower(merchant_domain) = lower(trim(p_merchant_domain))
      and lower(order_number) = lower(trim(p_order_number))
    limit 1;
  end if;

  if v_purchase_id is null then
    raise exception 'purchase could not be created or resolved idempotently';
  end if;

  insert into public.purchase_sources (
    purchase_id,
    source_email_id,
    relation_type,
    confidence
  )
  select
    v_purchase_id,
    x.source_email_id,
    coalesce(nullif(trim(x.relation_type), ''), 'evidence'),
    x.confidence
  from jsonb_to_recordset(p_sources) as x(source_email_id uuid, relation_type text, confidence numeric)
  on conflict (purchase_id, source_email_id)
  do update set
    relation_type = excluded.relation_type,
    confidence = excluded.confidence;

  return v_purchase_id;
end;
$$;

revoke all on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb) from public;
revoke all on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb) from anon;
revoke all on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb) from authenticated;
grant execute on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb) to service_role;
