-- BuyFlow own shopping email identity foundation.
-- Keeps the existing email_connections/source_emails model usable for SES inbound
-- without changing the live Nylas path.

alter table public.email_connections
  drop constraint if exists email_connections_provider_check;

alter table public.email_connections
  add constraint email_connections_provider_check
  check (provider in ('nylas', 'gmail', 'ses'));

-- One stable BuyFlow shopping address per user. If the address is ever disabled,
-- the same row can be reactivated instead of silently allocating a second identity.
create unique index if not exists uq_email_connections_ses_user
  on public.email_connections(user_id)
  where provider = 'ses';

-- BuyFlow addresses route directly to a user, so they must be globally unique.
create unique index if not exists uq_email_connections_ses_address
  on public.email_connections(lower(email_address))
  where provider = 'ses';
