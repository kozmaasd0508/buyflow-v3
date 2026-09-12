-- Run ONLY in the disposable CI database. No application/customer data.
\set ON_ERROR_STOP on
begin;
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;

do $$
declare target text;
begin
  foreach target in array array[
    'email_connections', 'source_emails', 'ai_processing_runs', 'purchases',
    'shipments', 'products', 'documents', 'purchase_sources', 'email_audit_results'
  ] loop
    execute format('create table public.%I (id integer primary key, value text)', target);
    execute format('grant select, insert, update, delete on public.%I to authenticated', target);
    execute format('grant all on public.%I to service_role', target);
  end loop;
end;
$$;
-- Include the legacy PUBLIC/anon grants the migration must also remove.
grant truncate, references, trigger on public.email_audit_results to public, anon;
\ir ../migrations/20260912184812_restrict_client_commerce_writes.sql

-- Backend writes still work.
set local role service_role;
insert into public.documents values (1, 'owned-path');
update public.documents set value='updated-path' where id=1;
reset role;

-- Execute real DML under the client role, rather than only reading grant lists.
set local role authenticated;
do $$
declare target text;
begin
  foreach target in array array[
    'email_connections', 'source_emails', 'ai_processing_runs', 'purchases',
    'shipments', 'products', 'documents', 'purchase_sources', 'email_audit_results'
  ] loop
    execute format('select count(*) from public.%I', target);
    begin
      execute format('insert into public.%I values (2, ''forged'')', target);
      raise exception 'Client insert unexpectedly allowed: %', target;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('update public.%I set value=''forged''', target);
      raise exception 'Client update unexpectedly allowed: %', target;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('delete from public.%I', target);
      raise exception 'Client delete unexpectedly allowed: %', target;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;
set local role service_role;
delete from public.documents where id=1;
reset role;
rollback;
