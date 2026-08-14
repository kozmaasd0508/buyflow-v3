-- These functions are trigger-only helpers. They do not need to be callable from
-- PostgREST by anonymous or signed-in users.
--
-- Keep service_role EXECUTE for controlled backend/admin use, while removing the
-- implicit PUBLIC grant that made the SECURITY DEFINER functions externally callable.
-- Also use an empty search_path; all table references inside both functions are
-- schema-qualified and PostgreSQL built-ins remain available through pg_catalog.

alter function public.apply_trusted_merchant_lifecycle_source()
  set search_path = '';

revoke all on function public.apply_trusted_merchant_lifecycle_source() from public;
revoke all on function public.apply_trusted_merchant_lifecycle_source() from anon;
revoke all on function public.apply_trusted_merchant_lifecycle_source() from authenticated;
grant execute on function public.apply_trusted_merchant_lifecycle_source() to service_role;

alter function public.reconcile_purchase_subtotal_from_products()
  set search_path = '';

revoke all on function public.reconcile_purchase_subtotal_from_products() from public;
revoke all on function public.reconcile_purchase_subtotal_from_products() from anon;
revoke all on function public.reconcile_purchase_subtotal_from_products() from authenticated;
grant execute on function public.reconcile_purchase_subtotal_from_products() to service_role;
