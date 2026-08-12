alter table public.source_emails
  add column if not exists validated_result jsonb,
  add column if not exists validation_status text,
  add column if not exists validated_at timestamptz;

alter table public.source_emails
  drop constraint if exists source_emails_validation_status_check;

alter table public.source_emails
  add constraint source_emails_validation_status_check
  check (
    validation_status is null
    or validation_status = any (
      array['validated'::text, 'guardrailed'::text, 'review'::text]
    )
  );
