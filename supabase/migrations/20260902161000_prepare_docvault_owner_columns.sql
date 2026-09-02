-- DocVault schema bridge for the live BuyFlow V3 database.
--
-- The original production documents table predates direct document ownership
-- and source-email provenance columns. The hardening migration that follows
-- requires both columns, so add and validate them first without inventing
-- ownership.

alter table public.documents
  add column if not exists user_id uuid;

alter table public.documents
  add column if not exists source_email_id uuid;

-- Existing production documents always belong to a Purchase. Derive the owner
-- only from that authoritative relationship.
update public.documents d
set user_id = p.user_id
from public.purchases p
where d.user_id is null
  and d.purchase_id = p.id;

-- Fail closed instead of silently accepting an orphan or cross-user row.
do $block$
begin
  if exists (
    select 1
    from public.documents d
    left join public.purchases p on p.id = d.purchase_id
    where p.id is null
       or d.user_id is null
       or d.user_id <> p.user_id
  ) then
    raise exception 'document ownership backfill requires review';
  end if;

  if exists (
    select 1
    from public.documents d
    join public.source_emails se on se.id = d.source_email_id
    where d.source_email_id is not null
      and se.user_id <> d.user_id
  ) then
    raise exception 'existing document source ownership mismatch requires review';
  end if;

  if exists (
    select 1
    from public.documents d
    left join public.source_emails se on se.id = d.source_email_id
    where d.source_email_id is not null
      and se.id is null
  ) then
    raise exception 'existing document source reference is orphaned';
  end if;
end;
$block$;

alter table public.documents
  alter column user_id set not null;

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.documents'::pg_catalog.regclass
      and c.conname = 'documents_user_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.documents'::pg_catalog.regclass
      and c.conname = 'documents_source_email_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_source_email_id_fkey
      foreign key (source_email_id) references public.source_emails(id) on delete set null;
  end if;
end;
$block$;

create index if not exists idx_documents_user
  on public.documents(user_id);

create index if not exists idx_documents_source_email
  on public.documents(source_email_id);
