alter table public.email_scan_jobs
  add column if not exists search_term text;

alter table public.email_scan_jobs
  drop constraint if exists email_scan_jobs_email_connection_id_kind_key,
  drop constraint if exists email_scan_jobs_kind_check,
  drop constraint if exists email_scan_jobs_window_days_check;

alter table public.email_scan_jobs
  add constraint email_scan_jobs_kind_check
    check (kind in ('initial','targeted')),
  add constraint email_scan_jobs_window_days_check
    check (window_days between 1 and 90),
  add constraint email_scan_jobs_search_term_check
    check (
      (kind = 'initial' and search_term is null)
      or
      (kind = 'targeted' and char_length(btrim(search_term)) between 2 and 120)
    );

create unique index if not exists uq_email_scan_jobs_initial
  on public.email_scan_jobs(email_connection_id, kind)
  where kind = 'initial';

create or replace function public.enqueue_initial_email_scan(
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
  if p_window_days < 1 or p_window_days > 30 then
    raise exception 'invalid window_days';
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
    user_id, email_connection_id, kind, window_days, search_term, status, next_attempt_at
  ) values (
    p_user_id, p_email_connection_id, 'initial', p_window_days, null, 'pending', now()
  )
  on conflict (email_connection_id, kind) where kind = 'initial'
  do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.enqueue_targeted_email_scan(
  p_user_id uuid,
  p_email_connection_id uuid,
  p_search_term text,
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
begin
  if p_window_days not in (7, 30, 90) then
    raise exception 'invalid window_days';
  end if;

  if char_length(v_term) < 2 or char_length(v_term) > 120 then
    raise exception 'invalid search_term';
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
    user_id, email_connection_id, kind, window_days, search_term, status, next_attempt_at
  ) values (
    p_user_id, p_email_connection_id, 'targeted', p_window_days, v_term, 'pending', now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_targeted_email_scan(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.enqueue_targeted_email_scan(uuid, uuid, text, integer) to service_role;
