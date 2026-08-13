-- BuyFlow V3: isolated AI benchmark results for 7/30/90 day inbox audits.
-- Audit runs must not mutate normal purchase-processing state until the user confirms a result.

create table if not exists public.email_audit_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.email_scan_jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source_email_id uuid not null references public.source_emails(id) on delete cascade,
  gmail_category_purchases boolean not null default false,
  filter_relevant boolean not null default false,
  filter_reasons jsonb not null default '[]'::jsonb,
  ai_event_type text,
  ai_confidence numeric(5,4) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  ai_validation_status text,
  ai_result jsonb,
  ai_error_code text,
  linked_purchase_id uuid references public.purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, source_email_id)
);

create index if not exists idx_email_audit_results_job
  on public.email_audit_results(job_id, created_at desc);
create index if not exists idx_email_audit_results_user
  on public.email_audit_results(user_id, created_at desc);

alter table public.email_audit_results enable row level security;

drop policy if exists email_audit_results_own_rows on public.email_audit_results;
create policy email_audit_results_own_rows on public.email_audit_results
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Keep direct client access closed. The authenticated BuyFlow API reads through service_role.
revoke all on table public.email_audit_results from public, anon, authenticated;
