alter table public.email_scan_jobs
  add column if not exists automatic_dedupe_key text;

create unique index if not exists uq_email_scan_jobs_automatic_dedupe
  on public.email_scan_jobs(email_connection_id, automatic_dedupe_key)
  where automatic_dedupe_key is not null;

create or replace function public.enqueue_automatic_targeted_email_scan(
  p_user_id uuid,
  p_email_connection_id uuid,
  p_search_term text,
  p_dedupe_key text,
  p_window_days integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_term text := btrim(regexp_replace(coalesce(p_search_term, ''), '\s+', ' ', 'g'));
  v_key text := btrim(coalesce(p_dedupe_key, ''));
begin
  if p_window_days not in (7, 30, 90) then
    raise exception 'invalid window_days';
  end if;

  if char_length(v_term) < 2 or char_length(v_term) > 120 then
    raise exception 'invalid search_term';
  end if;

  if char_length(v_key) < 16 or char_length(v_key) > 128 then
    raise exception 'invalid dedupe_key';
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
    next_attempt_at
  ) values (
    p_user_id,
    p_email_connection_id,
    'targeted',
    p_window_days,
    v_term,
    v_key,
    'pending',
    now()
  )
  on conflict (email_connection_id, automatic_dedupe_key)
    where automatic_dedupe_key is not null
  do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_automatic_targeted_email_scan(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.enqueue_automatic_targeted_email_scan(uuid, uuid, text, text, integer) to service_role;
