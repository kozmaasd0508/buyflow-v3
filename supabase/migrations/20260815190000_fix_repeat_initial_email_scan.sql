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
  if p_window_days not in (7, 30, 90) then
    raise exception 'invalid window_days';
  end if;

  if not exists (
    select 1
    from public.email_connections
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
    status,
    attempts,
    next_attempt_at,
    locked_at,
    processed_at,
    last_error_code,
    result,
    created_at,
    updated_at
  ) values (
    p_user_id,
    p_email_connection_id,
    'initial',
    p_window_days,
    null,
    'pending',
    0,
    now(),
    null,
    null,
    null,
    null,
    now(),
    now()
  )
  on conflict (email_connection_id, kind) where kind = 'initial'
  do update set
    user_id = excluded.user_id,
    window_days = excluded.window_days,
    search_term = null,
    status = 'pending',
    attempts = 0,
    next_attempt_at = now(),
    locked_at = null,
    processed_at = null,
    last_error_code = null,
    result = null,
    created_at = now(),
    updated_at = now()
  where public.email_scan_jobs.status <> 'processing'
  returning id into v_id;

  if v_id is null then
    raise exception 'initial email scan already processing';
  end if;

  return v_id;
end;
$$;

revoke all on function public.enqueue_initial_email_scan(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_initial_email_scan(uuid, uuid, integer)
  to service_role;
