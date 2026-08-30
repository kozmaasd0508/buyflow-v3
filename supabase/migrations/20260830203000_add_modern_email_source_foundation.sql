-- Modern email source foundation v1.
--
-- Raw provider/MIME bytes are stored in object storage. Postgres keeps only
-- immutable references, integrity metadata and normalization/trace identifiers.
-- This migration is additive and does not change current ingestion authority.

alter table public.source_emails
  add column if not exists raw_object_key text,
  add column if not exists raw_sha256 text,
  add column if not exists raw_size_bytes bigint,
  add column if not exists raw_content_type text,
  add column if not exists raw_retention_until timestamptz,
  add column if not exists normalized_object_key text,
  add column if not exists normalizer_version text,
  add column if not exists trace_id uuid;

alter table public.source_emails
  drop constraint if exists source_emails_raw_sha256_check,
  add constraint source_emails_raw_sha256_check
    check (raw_sha256 is null or raw_sha256 ~ '^[0-9a-fA-F]{64}$'),
  drop constraint if exists source_emails_raw_size_bytes_check,
  add constraint source_emails_raw_size_bytes_check
    check (raw_size_bytes is null or raw_size_bytes >= 0);

create index if not exists idx_source_emails_trace_id
  on public.source_emails(trace_id)
  where trace_id is not null;

create index if not exists idx_source_emails_raw_sha256
  on public.source_emails(user_id, raw_sha256)
  where raw_sha256 is not null;

comment on column public.source_emails.raw_object_key is
  'Object-storage key for immutable original provider/MIME bytes. Raw bytes are not stored inline in Postgres.';
comment on column public.source_emails.raw_sha256 is
  'SHA-256 of the immutable original provider/MIME bytes, lowercase or uppercase hex.';
comment on column public.source_emails.raw_size_bytes is
  'Byte length of the immutable original provider/MIME object.';
comment on column public.source_emails.raw_content_type is
  'Content type of the archived original source, e.g. message/rfc822.';
comment on column public.source_emails.raw_retention_until is
  'Optional retention/deletion boundary for the archived raw source.';
comment on column public.source_emails.normalized_object_key is
  'Optional object-storage key for the versioned normalized email document.';
comment on column public.source_emails.normalizer_version is
  'Version that produced the normalized email document used downstream.';
comment on column public.source_emails.trace_id is
  'Cross-pipeline trace identifier from provider ingestion through extraction/correlation.';
