-- BuyFlow Core authority hardening.
--
-- The legacy automatic Purchase creation / enrichment lane predates the
-- TrustLink trusted-sender authority contract. It must fail closed until a new
-- Purchase Core write contract proves the same authority at the database
-- boundary. Shipment and document writes are intentionally not disabled here;
-- those have separate controlled/audited write paths.

-- This trigger trusted the visible From domain and directly mutated Purchase
-- state. It bypasses TrustLink sender authority and JourneyGraph aggregation,
-- including multi-shipment completion semantics.
drop trigger if exists trg_apply_trusted_merchant_lifecycle_source
  on public.purchase_sources;
drop function if exists public.apply_trusted_merchant_lifecycle_source();

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
set search_path = ''
as $function$
begin
  raise exception 'legacy automatic Purchase creation is disabled by Core authority policy';
end;
$function$;

revoke all on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb)
  from public, anon, authenticated;
grant execute on function public.controlled_create_purchase_with_sources(uuid,text,text,text,timestamptz,numeric,jsonb)
  to service_role;

create or replace function public.controlled_enrich_purchase_from_order_source(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_order jsonb,
  p_products jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'legacy automatic Purchase financial/product enrichment is disabled by Core authority policy';
end;
$function$;

revoke all on function public.controlled_enrich_purchase_from_order_source(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.controlled_enrich_purchase_from_order_source(uuid,uuid,uuid,jsonb,jsonb)
  to service_role;

create or replace function public.controlled_apply_payment_evidence(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_payment jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'legacy automatic Purchase payment mutation is disabled by Core authority policy';
end;
$function$;

revoke all on function public.controlled_apply_payment_evidence(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.controlled_apply_payment_evidence(uuid,uuid,uuid,jsonb)
  to service_role;
