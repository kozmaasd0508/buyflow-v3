-- BuyFlow V3 - M1 core schema
-- Goal: Email -> AI -> Purchase -> Product / Shipment / Document
-- Fresh schema: no migration of legacy BuyFlow data.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('nylas', 'gmail')),
  provider_account_id text,
  email_address text not null,
  status text not null default 'active' check (status in ('active', 'disconnected', 'error')),
  last_history_id text,
  watch_expiration timestamptz,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

create table public.source_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider_message_id text not null,
  provider_thread_id text,
  from_address text,
  subject text,
  received_at timestamptz,
  source_kind text not null default 'discovery' check (source_kind in ('discovery', 'targeted_recovery', 'push', 'manual')),
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'processed', 'ignored', 'review', 'failed')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_connection_id, provider_message_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  merchant_name text,
  merchant_domain text,
  order_number text,
  purchase_date date,
  subtotal numeric(14,2),
  shipping_amount numeric(14,2),
  discount_amount numeric(14,2),
  total_amount numeric(14,2),
  currency text,
  payment_method text,
  payment_status text,
  current_state text not null default 'processing',
  ordered_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  source_confidence numeric(5,4) check (source_confidence is null or (source_confidence >= 0 and source_confidence <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  variant text,
  sku text,
  gtin text,
  category text,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2),
  total_price numeric(14,2),
  currency text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete set null,
  carrier text,
  carrier_slug text,
  tracking_number text,
  tracking_url text,
  status text,
  shipped_at timestamptz,
  estimated_delivery_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  source_email_id uuid references public.source_emails(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purchase_id uuid references public.purchases(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  source_email_id uuid references public.source_emails(id) on delete set null,
  type text not null check (type in ('invoice', 'receipt', 'warranty', 'return_label', 'credit_note', 'other')),
  document_number text,
  issued_at timestamptz,
  source_type text not null check (source_type in ('email_attachment', 'external_url', 'generated')),
  external_url text,
  provider_message_id text,
  attachment_id text,
  filename text,
  mime_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_sources (
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  source_email_id uuid not null references public.source_emails(id) on delete cascade,
  relation_type text not null default 'evidence' check (relation_type in ('origin', 'lifecycle', 'shipment', 'document', 'payment', 'evidence')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  primary key (purchase_id, source_email_id)
);

create table public.ai_processing_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_email_id uuid references public.source_emails(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  purpose text not null check (purpose in ('email_extraction', 'reconciliation', 'chat', 'refund_draft', 'other')),
  provider text not null,
  model text not null,
  prompt_version text,
  status text not null default 'completed' check (status in ('started', 'completed', 'failed')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(12,8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  output_json jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

-- Indexes for the hot paths used by ingestion, reconciliation and UI.
create index idx_email_connections_user on public.email_connections(user_id);
create index idx_source_emails_user_received on public.source_emails(user_id, received_at desc);
create index idx_source_emails_status on public.source_emails(user_id, processing_status);
create index idx_purchases_user_created on public.purchases(user_id, created_at desc);
create index idx_purchases_order_lookup on public.purchases(user_id, merchant_domain, order_number);
create index idx_products_purchase on public.products(purchase_id);
create index idx_shipments_purchase on public.shipments(purchase_id);
create index idx_shipments_tracking_lookup on public.shipments(user_id, carrier_slug, tracking_number);
create index idx_documents_purchase on public.documents(purchase_id);
create index idx_documents_product on public.documents(product_id);
create index idx_ai_runs_source_email on public.ai_processing_runs(source_email_id);

-- A real tracking number should be idempotent per user/carrier when known.
create unique index uq_shipments_tracking
  on public.shipments(user_id, carrier_slug, tracking_number)
  where tracking_number is not null and carrier_slug is not null;

-- Keep updated_at correct automatically.
create trigger trg_users_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger trg_email_connections_updated_at before update on public.email_connections
for each row execute function public.set_updated_at();
create trigger trg_source_emails_updated_at before update on public.source_emails
for each row execute function public.set_updated_at();
create trigger trg_purchases_updated_at before update on public.purchases
for each row execute function public.set_updated_at();
create trigger trg_products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger trg_shipments_updated_at before update on public.shipments
for each row execute function public.set_updated_at();
create trigger trg_documents_updated_at before update on public.documents
for each row execute function public.set_updated_at();

-- Row Level Security. The backend may use service_role; authenticated clients can
-- only ever see their own rows when client access is explicitly granted later.
alter table public.users enable row level security;
alter table public.email_connections enable row level security;
alter table public.source_emails enable row level security;
alter table public.purchases enable row level security;
alter table public.products enable row level security;
alter table public.shipments enable row level security;
alter table public.documents enable row level security;
alter table public.purchase_sources enable row level security;
alter table public.ai_processing_runs enable row level security;

create policy users_own_row on public.users
for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy email_connections_own_rows on public.email_connections
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy source_emails_own_rows on public.source_emails
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy purchases_own_rows on public.purchases
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy products_own_rows on public.products
for all to authenticated
using (
  exists (
    select 1 from public.purchases p
    where p.id = products.purchase_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.purchases p
    where p.id = products.purchase_id and p.user_id = auth.uid()
  )
);

create policy shipments_own_rows on public.shipments
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy documents_own_rows on public.documents
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy purchase_sources_own_rows on public.purchase_sources
for all to authenticated
using (
  exists (
    select 1 from public.purchases p
    where p.id = purchase_sources.purchase_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.purchases p
    where p.id = purchase_sources.purchase_id and p.user_id = auth.uid()
  )
);

create policy ai_processing_runs_own_rows on public.ai_processing_runs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Intentionally no grants here. The project was created with automatic Data API
-- exposure disabled, so tables stay private until the application explicitly
-- decides which client-side access (if any) should be granted.
