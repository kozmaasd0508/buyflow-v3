-- Durable direct-Gmail Pub/Sub wake-up queue.
-- Notifications only trigger source synchronization; they carry no Purchase authority.

create table if not exists public.gmail_sync_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  history_id text not null check (history_id ~ '^[0-9]+$'),
  status text not null default 'pending'
    check (status in ('pending','processing','retry','processed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_connection_id, history_id)
);

create index if not exists idx_gmail_sync_inbox_due
  on public.gmail_sync_inbox(status, next_attempt_at, created_at);

alter table public.gmail_sync_inbox enable row level security;
revoke all on table public.gmail_sync_inbox from anon, authenticated;
grant select, insert, update on table public.gmail_sync_inbox to service_role;

comment on table public.gmail_sync_inbox is
  'Durable authenticated Gmail Pub/Sub wake-up events. Processing may advance provider source cursor only after source persistence succeeds; never grants Purchase identity authority.';

create or replace function public.enqueue_gmail_history_event(
  p_email_address text,
  p_history_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if nullif(trim(p_email_address), '') is null then
    raise exception 'gmail_email_address_required';
  end if;
  if nullif(trim(p_history_id), '') is null or trim(p_history_id) !~ '^[0-9]+$' then
    raise exception 'gmail_history_id_invalid';
  end if;

  insert into public.gmail_sync_inbox (
    user_id,
    email_connection_id,
    history_id
  )
  select
    c.user_id,
    c.id,
    trim(p_history_id)
  from public.email_connections c
  where c.provider = 'gmail'
    and c.status = 'active'
    and lower(c.email_address) = lower(trim(p_email_address))
  on conflict (email_connection_id, history_id)
  do update set
    last_seen_at = now(),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_gmail_history_event(text, text) from public, anon, authenticated;
grant execute on function public.enqueue_gmail_history_event(text, text) to service_role;

create or replace function public.claim_gmail_sync_inbox_event(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.gmail_sync_inbox
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_at = now(),
    updated_at = now(),
    last_error_code = null
  where id = p_id
    and attempts < 8
    and (
      (status in ('pending','retry') and next_attempt_at <= now())
      or
      (status = 'processing' and locked_at < now() - interval '10 minutes')
    );

  v_claimed := found;
  return v_claimed;
end;
$$;

revoke all on function public.claim_gmail_sync_inbox_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_gmail_sync_inbox_event(uuid) to service_role;

create or replace function public.finish_gmail_sync_inbox_event(
  p_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$;
-- placeholder deliberately replaced below
$$;

-- Recreate with an explicit retry schedule so behavior is obvious/auditable and
-- does not depend on numeric/interval coercion rules.
create or replace function public.finish_gmail_sync_inbox_event(
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
    update public.gmail_sync_inbox
    set
      status = 'processed',
      processed_at = now(),
      locked_at = null,
      last_error_code = null,
      updated_at = now()
    where id = p_id;
  else
    update public.gmail_sync_inbox
    set
      status = case when attempts >= 8 then 'dead_letter' else 'retry' end,
      next_attempt_at = case
        when attempts >= 8 then next_attempt_at
        when attempts <= 1 then now() + interval '30 seconds'
        when attempts = 2 then now() + interval '1 minute'
        when attempts = 3 then now() + interval '2 minutes'
        when attempts = 4 then now() + interval '4 minutes'
        when attempts = 5 then now() + interval '8 minutes'
        when attempts = 6 then now() + interval '16 minutes'
        when attempts = 7 then now() + interval '32 minutes'
        else now() + interval '1 hour'
      end,
      locked_at = null,
      last_error_code = left(coalesce(p_error_code, 'gmail_sync_failed'), 80),
      updated_at = now()
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.finish_gmail_sync_inbox_event(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_gmail_sync_inbox_event(uuid, boolean, text) to service_role;
