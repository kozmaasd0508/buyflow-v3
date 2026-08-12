create or replace function public.apply_trusted_merchant_lifecycle_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_user_id uuid;
  v_merchant_domain text;
  v_purchase_order_number text;
  v_current_state text;
  v_source_user_id uuid;
  v_source_domain text;
  v_validation_status text;
  v_event_type text;
  v_source_order_number text;
  v_confidence numeric;
  v_received_at timestamptz;
begin
  if new.relation_type not in ('shipment', 'delivery') then
    return new;
  end if;

  select p.user_id, lower(nullif(btrim(p.merchant_domain), '')), p.order_number, p.current_state
    into v_purchase_user_id, v_merchant_domain, v_purchase_order_number, v_current_state
  from public.purchases p
  where p.id = new.purchase_id;

  if v_purchase_user_id is null
     or v_merchant_domain is null
     or nullif(btrim(v_purchase_order_number), '') is null then
    return new;
  end if;

  select
    se.user_id,
    lower(nullif(btrim(split_part(coalesce(se.from_address, ''), '@', 2)), '')),
    coalesce(se.validated_result->>'validation_status', se.validation_status),
    se.validated_result->>'event_type',
    se.validated_result->>'order_number',
    case
      when coalesce(se.validated_result->>'confidence', '') ~ '^[0-9]+([.][0-9]+)?$'
        then (se.validated_result->>'confidence')::numeric
      else null
    end,
    se.received_at
  into
    v_source_user_id,
    v_source_domain,
    v_validation_status,
    v_event_type,
    v_source_order_number,
    v_confidence,
    v_received_at
  from public.source_emails se
  where se.id = new.source_email_id;

  if v_source_user_id is distinct from v_purchase_user_id
     or v_validation_status not in ('validated', 'guardrailed')
     or v_event_type is distinct from new.relation_type
     or v_confidence is null
     or v_confidence < 0.85
     or v_source_domain is distinct from v_merchant_domain
     or lower(btrim(coalesce(v_source_order_number, ''))) is distinct from lower(btrim(v_purchase_order_number)) then
    return new;
  end if;

  if v_current_state in ('cancelled', 'refunded', 'returned') then
    return new;
  end if;

  if new.relation_type = 'delivery' then
    update public.purchases
    set current_state = 'delivered',
        delivered_at = case
          when delivered_at is null then v_received_at
          when v_received_at is null then delivered_at
          else least(delivered_at, v_received_at)
        end
    where id = new.purchase_id
      and user_id = v_purchase_user_id
      and current_state not in ('cancelled', 'refunded', 'returned');
  elsif new.relation_type = 'shipment' then
    update public.purchases
    set current_state = case
          when current_state = 'delivered' then 'delivered'
          when current_state in ('processing', 'ordered', 'paid') then 'in_transit'
          else current_state
        end,
        shipped_at = case
          when shipped_at is null then v_received_at
          when v_received_at is null then shipped_at
          else least(shipped_at, v_received_at)
        end
    where id = new.purchase_id
      and user_id = v_purchase_user_id
      and current_state not in ('cancelled', 'refunded', 'returned');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_trusted_merchant_lifecycle_source on public.purchase_sources;
create trigger trg_apply_trusted_merchant_lifecycle_source
after insert or update of relation_type, confidence
on public.purchase_sources
for each row
execute function public.apply_trusted_merchant_lifecycle_source();

-- Re-evaluate already-linked lifecycle evidence with the new deterministic state rule.
update public.purchase_sources
set confidence = confidence
where relation_type in ('shipment', 'delivery');
