alter table public.email_scan_jobs
  drop constraint if exists email_scan_jobs_window_days_check;

alter table public.email_scan_jobs
  add constraint email_scan_jobs_window_days_check
    check (window_days between 1 and 365);

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
  if p_window_days not in (7, 30, 90, 365) then
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

create or replace function public.reset_buyflow_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ai_runs integer := 0;
  v_audit_results integer := 0;
  v_scan_jobs integer := 0;
  v_oauth_states integer := 0;
  v_source_emails integer := 0;
  v_purchases integer := 0;
  v_connections integer := 0;
begin
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'user not found';
  end if;

  select count(*) into v_connections
  from public.email_connections
  where user_id = p_user_id;

  delete from public.ai_processing_runs where user_id = p_user_id;
  get diagnostics v_ai_runs = row_count;

  delete from public.email_audit_results where user_id = p_user_id;
  get diagnostics v_audit_results = row_count;

  delete from public.email_scan_jobs where user_id = p_user_id;
  get diagnostics v_scan_jobs = row_count;

  delete from public.email_oauth_states where user_id = p_user_id;
  get diagnostics v_oauth_states = row_count;

  delete from public.source_emails where user_id = p_user_id;
  get diagnostics v_source_emails = row_count;

  delete from public.purchases where user_id = p_user_id;
  get diagnostics v_purchases = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'aiProcessingRuns', v_ai_runs,
      'emailAuditResults', v_audit_results,
      'emailScanJobs', v_scan_jobs,
      'emailOauthStates', v_oauth_states,
      'sourceEmails', v_source_emails,
      'purchases', v_purchases
    ),
    'preserved', jsonb_build_object(
      'user', true,
      'emailConnections', v_connections
    )
  );
end;
$$;

revoke all on function public.reset_buyflow_user_data(uuid) from public, anon, authenticated;
grant execute on function public.reset_buyflow_user_data(uuid) to service_role;
