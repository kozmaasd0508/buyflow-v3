-- BuyFlow direct Gmail runtime foundation.
-- Additive only: no runtime cutover and no Purchase/Identity authority change.

alter table public.email_oauth_states
  drop constraint if exists email_oauth_states_provider_check;

alter table public.email_oauth_states
  add constraint email_oauth_states_provider_check
  check (provider in ('nylas', 'gmail'));

alter table public.email_oauth_states
  add column if not exists pkce_verifier text,
  add column if not exists redirect_uri text;

comment on column public.email_oauth_states.pkce_verifier is
  'Short-lived server-only PKCE verifier. Deleted atomically when the OAuth callback consumes the state.';

create table if not exists public.email_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_connection_id uuid not null unique references public.email_connections(id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_auth_tag text not null,
  key_version integer not null default 1 check (key_version > 0),
  scopes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_provider_credentials_user
  on public.email_provider_credentials(user_id);

alter table public.email_provider_credentials enable row level security;
revoke all on table public.email_provider_credentials from anon, authenticated;

comment on table public.email_provider_credentials is
  'Server-only encrypted provider refresh credentials. Plain OAuth tokens must never be stored in this table.';

create trigger trg_email_provider_credentials_updated_at
before update on public.email_provider_credentials
for each row execute function public.set_updated_at();

create table if not exists public.email_sync_states (
  email_connection_id uuid primary key references public.email_connections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  cursor_value text,
  cursor_observed_at timestamptz,
  watch_expires_at timestamptz,
  watch_resource_id text,
  watch_payload jsonb not null default '{}'::jsonb,
  sync_status text not null default 'idle'
    check (sync_status in ('idle', 'syncing', 'reset_required', 'error')),
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_sync_states_user
  on public.email_sync_states(user_id);

create index if not exists idx_email_sync_states_watch_expiry
  on public.email_sync_states(watch_expires_at)
  where watch_expires_at is not null;

alter table public.email_sync_states enable row level security;
revoke all on table public.email_sync_states from anon, authenticated;

comment on table public.email_sync_states is
  'Server-only provider cursor/watch state. Cursor advancement is separate from Purchase identity state.';

create trigger trg_email_sync_states_updated_at
before update on public.email_sync_states
for each row execute function public.set_updated_at();
