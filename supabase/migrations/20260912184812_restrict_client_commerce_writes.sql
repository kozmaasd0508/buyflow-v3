-- Commerce evidence and storage locations are server-owned. User edits go
-- through authenticated API routes, including the product override endpoints.
-- Keep existing SELECT/RLS behavior and all service_role privileges unchanged.
-- https://supabase.com/docs/guides/api/securing-your-api
revoke insert, update, delete, truncate, references, trigger on table
  public.email_connections,
  public.source_emails,
  public.ai_processing_runs,
  public.purchases,
  public.shipments,
  public.products,
  public.documents,
  public.purchase_sources,
  public.email_audit_results
from public, anon, authenticated;

-- Abort if inherited or column-level grants still permit a client write.
-- This validates the effective privileges, not just the explicit ACL entries.
do $$
declare
  target text;
  client_role text;
  privilege text;
begin
  foreach target in array array[
    'email_connections', 'source_emails', 'ai_processing_runs', 'purchases',
    'shipments', 'products', 'documents', 'purchase_sources', 'email_audit_results'
  ] loop
    foreach client_role in array array['anon', 'authenticated'] loop
      foreach privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(client_role, 'public.' || target, privilege) then
          raise exception 'Client % still has % on %', client_role, privilege, target;
        end if;
      end loop;
      foreach privilege in array array['INSERT','UPDATE','REFERENCES'] loop
        if has_any_column_privilege(client_role, 'public.' || target, privilege) then
          raise exception 'Client % still has column % on %', client_role, privilege, target;
        end if;
      end loop;
    end loop;
    if not has_table_privilege('service_role', 'public.' || target, 'SELECT')
      or not has_table_privilege('service_role', 'public.' || target, 'INSERT')
      or not has_table_privilege('service_role', 'public.' || target, 'UPDATE') then
      raise exception 'Missing existing backend access on %', target;
    end if;
  end loop;
end;
$$;
