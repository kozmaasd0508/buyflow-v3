-- Harden RawVault / modern email source archive v1.
--
-- Goals:
-- - stage an opaque durable manifest before object writes;
-- - retain manifest state after user/source-row deletion so orphan objects can be cleaned;
-- - make archive identity/integrity metadata immutable at DB level;
-- - track explicit raw + normalized retention and deletion timestamps.
--
-- Additive only. No provider cutover or Purchase/Identity authority change.

create table if not exists public.email_source_archive_manifests (
  trace_id uuid primary key,
  source_identity_sha256 text not null unique
    check (source_identity_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending','committed','deleted','error')),

  raw_object_key text,
  raw_sha256 text check (raw_sha256 is null or raw_sha256 ~ '^[0-9a-f]{64}$'),
  raw_size_bytes bigint check (raw_size_bytes is null or raw_size_bytes > 0),
  raw_content_type text,
  raw_retention_until timestamptz,
  raw_deleted_at timestamptz,

  normalized_object_key text not null,
  normalized_sha256 text not null check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_size_bytes bigint not null check (normalized_size_bytes > 0),
  normalized_content_type text not null default 'application/json',
  normalized_retention_until timestamptz not null,
  normalized_deleted_at timestamptz,

  committed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (raw_object_key is null and raw_sha256 is null and raw_size_bytes is null and raw_content_type is null and raw_retention_until is null)
    or
    (raw_object_key is not null and raw_sha256 is not null and raw_size_bytes is not null and raw_content_type is not null and raw_retention_until is not null)
  )
);

create index if not exists idx_email_source_archive_manifest_status
  on public.email_source_archive_manifests(status, created_at);
create index if not exists idx_email_source_archive_manifest_raw_retention
  on public.email_source_archive_manifests(raw_retention_until)
  where raw_retention_until is not null and raw_deleted_at is null;
create index if not exists idx_email_source_archive_manifest_normalized_retention
  on public.email_source_archive_manifests(normalized_retention_until)
  where normalized_deleted_at is null;

alter table public.email_source_archive_manifests enable row level security;
revoke all on table public.email_source_archive_manifests from anon, authenticated;
grant select, insert, update on table public.email_source_archive_manifests to service_role;

comment on table public.email_source_archive_manifests is
  'Opaque durable RawVault write/delete journal. Contains object integrity/retention metadata only, no provider message id, user id, subject or body.';

alter table public.source_emails
  add column if not exists archive_manifest_id uuid,
  add column if not exists normalized_retention_until timestamptz,
  add column if not exists raw_deleted_at timestamptz,
  add column if not exists normalized_deleted_at timestamptz;

alter table public.source_emails
  drop constraint if exists source_emails_archive_manifest_id_fkey,
  add constraint source_emails_archive_manifest_id_fkey
    foreign key (archive_manifest_id)
    references public.email_source_archive_manifests(trace_id)
    on delete restrict;

create unique index if not exists uq_source_emails_archive_manifest_id
  on public.source_emails(archive_manifest_id)
  where archive_manifest_id is not null;

comment on column public.source_emails.archive_manifest_id is
  'Opaque RawVault manifest id staged before object writes.';
comment on column public.source_emails.normalized_retention_until is
  'Explicit deletion boundary for the normalized source document object.';
comment on column public.source_emails.raw_deleted_at is
  'Timestamp when the raw source object was removed by retention/account cleanup.';
comment on column public.source_emails.normalized_deleted_at is
  'Timestamp when the normalized source document object was removed by retention/account cleanup.';

create or replace function public.protect_source_email_archive_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if row(
    old.archive_manifest_id,
    old.raw_object_key,
    old.raw_sha256,
    old.raw_size_bytes,
    old.raw_content_type,
    old.raw_retention_until,
    old.normalized_object_key,
    old.normalized_sha256,
    old.normalized_size_bytes,
    old.normalized_content_type,
    old.normalizer_version,
    old.normalized_retention_until,
    old.trace_id
  ) is distinct from row(
    new.archive_manifest_id,
    new.raw_object_key,
    new.raw_sha256,
    new.raw_size_bytes,
    new.raw_content_type,
    new.raw_retention_until,
    new.normalized_object_key,
    new.normalized_sha256,
    new.normalized_size_bytes,
    new.normalized_content_type,
    new.normalizer_version,
    new.normalized_retention_until,
    new.trace_id
  ) then
    raise exception 'source_email_archive_metadata_is_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_source_email_archive_metadata() from public, anon, authenticated;
grant execute on function public.protect_source_email_archive_metadata() to service_role;

drop trigger if exists trg_protect_source_email_archive_metadata on public.source_emails;
create trigger trg_protect_source_email_archive_metadata
before update on public.source_emails
for each row execute function public.protect_source_email_archive_metadata();

create or replace function public.protect_email_source_archive_manifest_artifacts()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if row(
    old.source_identity_sha256,
    old.raw_object_key,
    old.raw_sha256,
    old.raw_size_bytes,
    old.raw_content_type,
    old.raw_retention_until,
    old.normalized_object_key,
    old.normalized_sha256,
    old.normalized_size_bytes,
    old.normalized_content_type,
    old.normalized_retention_until
  ) is distinct from row(
    new.source_identity_sha256,
    new.raw_object_key,
    new.raw_sha256,
    new.raw_size_bytes,
    new.raw_content_type,
    new.raw_retention_until,
    new.normalized_object_key,
    new.normalized_sha256,
    new.normalized_size_bytes,
    new.normalized_content_type,
    new.normalized_retention_until
  ) then
    raise exception 'email_source_archive_manifest_artifacts_are_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_email_source_archive_manifest_artifacts() from public, anon, authenticated;
grant execute on function public.protect_email_source_archive_manifest_artifacts() to service_role;

drop trigger if exists trg_email_source_archive_manifest_artifacts_immutable on public.email_source_archive_manifests;
create trigger trg_email_source_archive_manifest_artifacts_immutable
before update on public.email_source_archive_manifests
for each row execute function public.protect_email_source_archive_manifest_artifacts();

drop trigger if exists trg_email_source_archive_manifests_updated_at on public.email_source_archive_manifests;
create trigger trg_email_source_archive_manifests_updated_at
before update on public.email_source_archive_manifests
for each row execute function public.set_updated_at();
