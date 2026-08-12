create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text not null,
  grant_id text not null,
  provider_message_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_inbox_status_check check (status in ('pending','processing','retry','processed')),
  constraint webhook_inbox_provider_check check (provider in ('nylas')),
  constraint webhook_inbox_identity_unique unique (provider, event_type, grant_id, provider_message_id)
);

create index if not exists idx_webhook_inbox_due
  on public.webhook_inbox (status, next_attempt_at, created_at);

alter table public.webhook_inbox enable row level security;

revoke all on table public.webhook_inbox from anon, authenticated;
grant select, insert, update on table public.webhook_inbox to service_role;

create or replace function public.enqueue_nylas_message_event(
  p_grant_id text,
  p_provider_message_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if nullif(trim(p_grant_id), '') is null then
    raise exception 'grant_id_required';
  end if;
  if nullif(trim(p_provider_message_id), '') is null then
    raise exception 'provider_message_id_required';
  end if;

  insert into public.webhook_inbox (
    provider,
    event_type,
    grant_id,
    provider_message_id
  ) values (
    'nylas',
    'message.created',
    trim(p_grant_id),
    trim(p_provider_message_id)
  )
  on conflict (provider, event_type, grant_id, provider_message_id)
  do update set
    last_seen_at = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_nylas_message_event(text, text) from public, anon, authenticated;
grant execute on function public.enqueue_nylas_message_event(text, text) to service_role;

create or replace function public.claim_webhook_inbox_event(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.webhook_inbox
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_at = now(),
    updated_at = now(),
    last_error_code = null
  where id = p_id
    and (
      (status in ('pending','retry') and next_attempt_at <= now())
      or
      (status = 'processing' and locked_at < now() - interval '10 minutes')
    );

  v_claimed := found;
  return v_claimed;
end;
$$;

revoke all on function public.claim_webhook_inbox_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_inbox_event(uuid) to service_role;

create or replace function public.finish_webhook_inbox_event(
  p_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_success then
    update public.webhook_inbox
    set
      status = 'processed',
      processed_at = now(),
      locked_at = null,
      last_error_code = null,
      updated_at = now()
    where id = p_id;
  else
    update public.webhook_inbox
    set
      status = 'retry',
      next_attempt_at = now() + (least(greatest(attempts, 1), 10) * interval '1 minute'),
      locked_at = null,
      last_error_code = left(coalesce(p_error_code, 'processing_failed'), 80),
      updated_at = now()
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.finish_webhook_inbox_event(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_webhook_inbox_event(uuid, boolean, text) to service_role;
