-- JourneyGraph safety: a Purchase is delivered only when every linked Shipment is delivered.
-- This replaces the controlled shipment RPC without applying anything automatically.

create or replace function public.controlled_upsert_shipment_with_sources(
  p_user_id uuid,
  p_purchase_id uuid,
  p_carrier text,
  p_carrier_slug text,
  p_tracking_number text,
  p_status text,
  p_shipped_at timestamptz,
  p_delivered_at timestamptz,
  p_last_event_at timestamptz,
  p_source_email_id uuid,
  p_confidence numeric,
  p_sources jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_shipment_id uuid;
  v_existing_shipment_id uuid;
  v_existing_purchase_id uuid;
  v_purchase_state text;
  v_source_count integer;
  v_valid_source_count integer;
  v_shipment_count integer;
  v_delivered_count integer;
  v_in_transit_count integer;
  v_ready_for_pickup_count integer;
  v_known_progress_count integer;
  v_delivered_timestamp_count integer;
  v_aggregate_state text;
  v_aggregate_shipped_at timestamptz;
  v_aggregate_delivered_at timestamptz;
begin
  if p_user_id is null or p_purchase_id is null then
    raise exception 'shipment user and purchase are required';
  end if;

  if nullif(trim(p_carrier_slug), '') is null or nullif(trim(p_tracking_number), '') is null then
    raise exception 'shipment carrier and tracking identity are required';
  end if;

  if p_status not in ('in_transit', 'ready_for_pickup', 'delivered') then
    raise exception 'unsupported controlled shipment status';
  end if;

  if p_status = 'delivered' and p_delivered_at is null then
    raise exception 'delivered shipment requires delivered_at';
  end if;

  select current_state
    into v_purchase_state
  from public.purchases
  where id = p_purchase_id
    and user_id = p_user_id;

  if v_purchase_state is null then
    raise exception 'target purchase does not belong to target user';
  end if;

  if v_purchase_state in ('cancelled', 'refunded', 'returned') then
    raise exception 'terminal purchase state cannot be overwritten by shipment resolution';
  end if;

  if pg_catalog.jsonb_typeof(p_sources) <> 'array' or pg_catalog.jsonb_array_length(p_sources) = 0 then
    raise exception 'shipment sources are required';
  end if;

  v_source_count := pg_catalog.jsonb_array_length(p_sources);

  select count(*)
    into v_valid_source_count
  from pg_catalog.jsonb_to_recordset(p_sources) as x(source_email_id uuid, confidence numeric)
  join public.source_emails se on se.id = x.source_email_id
  where se.user_id = p_user_id;

  if v_valid_source_count <> v_source_count then
    raise exception 'one or more shipment sources do not belong to the target user';
  end if;

  if not exists (
    select 1
    from public.source_emails se
    where se.id = p_source_email_id
      and se.user_id = p_user_id
  ) then
    raise exception 'primary shipment source does not belong to target user';
  end if;

  select id, purchase_id
    into v_existing_shipment_id, v_existing_purchase_id
  from public.shipments
  where user_id = p_user_id
    and carrier_slug = lower(trim(p_carrier_slug))
    and tracking_number = upper(pg_catalog.regexp_replace(p_tracking_number, '[^a-zA-Z0-9]', '', 'g'))
  limit 1;

  if v_existing_shipment_id is not null
     and v_existing_purchase_id is not null
     and v_existing_purchase_id <> p_purchase_id then
    raise exception 'tracking identity is already linked to another purchase';
  end if;

  insert into public.shipments (
    user_id,
    purchase_id,
    carrier,
    carrier_slug,
    tracking_number,
    status,
    shipped_at,
    delivered_at,
    last_event_at
  ) values (
    p_user_id,
    p_purchase_id,
    nullif(trim(p_carrier), ''),
    lower(trim(p_carrier_slug)),
    upper(pg_catalog.regexp_replace(p_tracking_number, '[^a-zA-Z0-9]', '', 'g')),
    p_status,
    p_shipped_at,
    p_delivered_at,
    p_last_event_at
  )
  on conflict (user_id, carrier_slug, tracking_number)
    where tracking_number is not null and carrier_slug is not null
  do update set
    purchase_id = coalesce(public.shipments.purchase_id, excluded.purchase_id),
    carrier = coalesce(public.shipments.carrier, excluded.carrier),
    status = case
      when public.shipments.status = 'delivered' or excluded.status = 'delivered' then 'delivered'
      when public.shipments.status = 'ready_for_pickup' or excluded.status = 'ready_for_pickup' then 'ready_for_pickup'
      else 'in_transit'
    end,
    shipped_at = case
      when public.shipments.shipped_at is null then excluded.shipped_at
      when excluded.shipped_at is null then public.shipments.shipped_at
      else least(public.shipments.shipped_at, excluded.shipped_at)
    end,
    delivered_at = case
      when public.shipments.delivered_at is null then excluded.delivered_at
      when excluded.delivered_at is null then public.shipments.delivered_at
      else least(public.shipments.delivered_at, excluded.delivered_at)
    end,
    last_event_at = case
      when public.shipments.last_event_at is null then excluded.last_event_at
      when excluded.last_event_at is null then public.shipments.last_event_at
      else greatest(public.shipments.last_event_at, excluded.last_event_at)
    end
  returning id into v_shipment_id;

  if v_shipment_id is null then
    raise exception 'shipment could not be created or resolved idempotently';
  end if;

  insert into public.purchase_sources (
    purchase_id,
    source_email_id,
    relation_type,
    confidence
  )
  select
    p_purchase_id,
    x.source_email_id,
    'shipment',
    x.confidence
  from pg_catalog.jsonb_to_recordset(p_sources) as x(source_email_id uuid, confidence numeric)
  on conflict (purchase_id, source_email_id)
  do update set
    relation_type = excluded.relation_type,
    confidence = excluded.confidence;

  -- Reduce every Shipment under this Purchase together. One delivered parcel is
  -- not enough to complete a multi-parcel Purchase.
  select
    count(*)::integer,
    count(*) filter (where status = 'delivered')::integer,
    count(*) filter (where status in ('in_transit', 'shipped'))::integer,
    count(*) filter (where status = 'ready_for_pickup')::integer,
    count(*) filter (where status in ('delivered', 'in_transit', 'shipped', 'ready_for_pickup'))::integer,
    count(delivered_at) filter (where status = 'delivered')::integer,
    min(shipped_at),
    max(delivered_at) filter (where status = 'delivered')
  into
    v_shipment_count,
    v_delivered_count,
    v_in_transit_count,
    v_ready_for_pickup_count,
    v_known_progress_count,
    v_delivered_timestamp_count,
    v_aggregate_shipped_at,
    v_aggregate_delivered_at
  from public.shipments
  where user_id = p_user_id
    and purchase_id = p_purchase_id;

  if v_shipment_count <= 0 then
    raise exception 'purchase shipment aggregate unexpectedly empty';
  end if;

  v_aggregate_state := case
    when v_delivered_count = v_shipment_count then 'delivered'
    when v_in_transit_count > 0 then 'in_transit'
    when v_ready_for_pickup_count > 0 then 'ready_for_pickup'
    -- Unknown/legacy non-delivered Shipment state must never preserve a false
    -- whole-Purchase delivered state. Processing is the conservative fallback.
    when v_known_progress_count < v_shipment_count then 'processing'
    else 'processing'
  end;

  update public.purchases
  set
    current_state = case
      when current_state in ('cancelled', 'refunded', 'returned') then current_state
      when v_aggregate_state = 'delivered' then 'delivered'
      when v_aggregate_state = 'ready_for_pickup' then 'ready_for_pickup'
      when v_aggregate_state = 'in_transit'
        and current_state in ('processing', 'ordered', 'paid', 'in_transit', 'ready_for_pickup', 'delivered') then 'in_transit'
      when v_aggregate_state = 'processing'
        and current_state in ('ready_for_pickup', 'delivered') then 'processing'
      else current_state
    end,
    shipped_at = coalesce(v_aggregate_shipped_at, shipped_at),
    delivered_at = case
      when v_aggregate_state <> 'delivered' then null
      when v_delivered_timestamp_count <> v_shipment_count then null
      else v_aggregate_delivered_at
    end
  where id = p_purchase_id
    and user_id = p_user_id;

  return v_shipment_id;
end;
$function$;

revoke all on function public.controlled_upsert_shipment_with_sources(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, numeric, jsonb) from public;
revoke all on function public.controlled_upsert_shipment_with_sources(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, numeric, jsonb) from anon;
revoke all on function public.controlled_upsert_shipment_with_sources(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, numeric, jsonb) from authenticated;
grant execute on function public.controlled_upsert_shipment_with_sources(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, uuid, numeric, jsonb) to service_role;
