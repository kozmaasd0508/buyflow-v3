-- Short-lived, fenced extraction claims. Only the backend may call these RPCs.
alter table public.source_emails
  add column processing_started_at timestamptz,
  add column processing_claim uuid;

create index source_emails_stale_processing
  on public.source_emails (processing_started_at, id)
  where processing_status = 'processing';

create function public.claim_source_extraction(p_id uuid, p_expected_status text, p_claim uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_claim is null then raise exception 'claim_required'; end if;
  update public.source_emails
  set processing_status = 'processing', processing_started_at = clock_timestamp(), processing_claim = p_claim
  where id = p_id and (
    (processing_status = p_expected_status and processing_status in ('pending','error','review','unlinked','processed'))
    or (processing_status = 'processing' and
      (processing_started_at is null or processing_started_at < clock_timestamp() - interval '5 minutes'))
  );
  return found;
end;
$$;

create function public.finish_source_extraction(
  p_id uuid, p_claim uuid, p_extraction jsonb, p_validated jsonb, p_run jsonb
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from public.source_emails
  where id = p_id and processing_status = 'processing' and processing_claim = p_claim
    and processing_started_at >= clock_timestamp() - interval '5 minutes'
  for update;
  if not found then return false; end if;

  insert into public.ai_processing_runs (
    user_id, source_email_id, purpose, provider, model, prompt_version,
    status, input_tokens, output_tokens, confidence, result
  ) values (
    v_user_id, p_id, 'email_extraction', 'openai', p_run->>'model', p_run->>'prompt_version',
    'completed', (p_run->>'input_tokens')::integer, (p_run->>'output_tokens')::integer,
    (p_run->>'confidence')::numeric, p_run->'result'
  );
  update public.source_emails set
    classification = p_extraction->>'event_type', structured_result = p_extraction,
    validated_result = p_validated, validation_status = 'review',
    validated_at = clock_timestamp(), processed_at = clock_timestamp(),
    processing_status = 'review', processing_claim = null, processing_started_at = null
  where id = p_id;
  return true;
end;
$$;

create function public.release_source_extraction(p_id uuid, p_claim uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.source_emails set processing_status = 'error', processing_claim = null,
    processing_started_at = null
  where id = p_id and processing_status = 'processing' and processing_claim = p_claim;
  return found;
end;
$$;

revoke all on function public.claim_source_extraction(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.finish_source_extraction(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.release_source_extraction(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_source_extraction(uuid,text,uuid) to service_role;
grant execute on function public.finish_source_extraction(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.release_source_extraction(uuid,uuid) to service_role;

-- Recover sources even if an older worker already acknowledged their webhook.
-- Keep retry backoff and active inbox locks intact. No source results are changed.
create function public.requeue_stale_source_extractions()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  insert into public.webhook_inbox (provider, event_type, grant_id, provider_message_id)
  select 'nylas', 'message.created', c.provider_account_id, s.provider_message_id
  from public.source_emails s
  join public.email_connections c on c.id = s.email_connection_id and c.user_id = s.user_id
  where s.processing_status = 'processing'
    and (s.processing_started_at is null or s.processing_started_at < clock_timestamp() - interval '5 minutes')
    and c.provider = 'nylas' and c.status = 'active' and c.provider_account_id is not null
  and not exists (
    select 1 from public.webhook_inbox w where w.provider = 'nylas' and w.event_type = 'message.created'
      and w.grant_id = c.provider_account_id and w.provider_message_id = s.provider_message_id
      and w.status <> 'processed'
  )
  order by s.processing_started_at nulls first, s.id
  limit 100
  on conflict (provider, event_type, grant_id, provider_message_id)
  do update set status = 'retry', next_attempt_at = clock_timestamp(), processed_at = null,
    locked_at = null, updated_at = clock_timestamp(), last_error_code = 'SourceLeaseExpired'
  where public.webhook_inbox.status = 'processed';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.requeue_stale_source_extractions() from public, anon, authenticated;
grant execute on function public.requeue_stale_source_extractions() to service_role;
