alter table public.email_scan_jobs
  drop constraint if exists email_scan_jobs_kind_check,
  drop constraint if exists email_scan_jobs_search_term_check;

alter table public.email_scan_jobs
  add constraint email_scan_jobs_kind_check
    check (kind in ('initial','targeted','audit')),
  add constraint email_scan_jobs_search_term_check
    check (
      (kind in ('initial','audit') and search_term is null)
      or
      (kind = 'targeted' and char_length(btrim(search_term)) between 2 and 120)
    );

create or replace function public.enqueue_full_audit_email_scan(
  p_user_id uuid,
  p_email_connection_id uuid,
  p_window_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_window_days <> 7 then
    raise exception 'full audit currently supports exactly 7 days';
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
    7,
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
