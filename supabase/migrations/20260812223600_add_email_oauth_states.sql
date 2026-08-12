create table if not exists public.email_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('nylas')),
  state_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_oauth_states_expires_at
  on public.email_oauth_states(expires_at);

alter table public.email_oauth_states enable row level security;

comment on table public.email_oauth_states is
  'Short-lived server-only OAuth state records for connecting email providers.';
