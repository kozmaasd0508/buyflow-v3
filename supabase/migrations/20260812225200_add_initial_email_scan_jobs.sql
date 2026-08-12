create table if not exists public.email_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  kind text not null default 'initial' check (kind in ('initial')),
  window_days integer not null default 7 check (window_days between 1 and 30),
  status text not null default 'pending' check (status in ('pending','processing','retry','processed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_connection_id, kind)
);

create index if not exists idx_email_scan_jobs_due
  on public.email_scan_jobs(status, next_attempt_at, created_at);

alter table public.email_scan_jobs enable row level security;

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
    user_id, email_connection_id, kind, window_days, status, next_attempt_at
  ) values (
    p_user_id, p_email_connection_id, 'initial', p_window_days, 'pending', now()
  )
  on conflict (email_connection_id, kind)
  do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.claim_email_scan_job(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  update public.email_scan_jobs
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      updated_at = now()
  where id = p_id
    and (
      (status in ('pending','retry') and next_attempt_at <= now())
      or (status = 'processing' and locked_at < now() - interval '10 minutes')
    )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

create or replace function public.finish_email_scan_job(
  p_id uuid,
  p_success boolean,
  p_error_code text default null,
  p_result jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_success then
    update public.email_scan_jobs
    set status = 'processed',
        processed_at = now(),
        locked_at = null,
        last_error_code = null,
        result = p_result,
        updated_at = now()
    where id = p_id;
  else
    update public.email_scan_jobs
    set status = 'retry',
        next_attempt_at = now() + (least(greatest(attempts, 1), 10) * interval '1 minute'),
        locked_at = null,
        last_error_code = left(coalesce(p_error_code, 'UnknownError'), 80),
        updated_at = now()
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.enqueue_initial_email_scan(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_email_scan_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_email_scan_job(uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_initial_email_scan(uuid, uuid, integer) to service_role;
grant execute on function public.claim_email_scan_job(uuid) to service_role;
grant execute on function public.finish_email_scan_job(uuid, boolean, text, jsonb) to service_role;
