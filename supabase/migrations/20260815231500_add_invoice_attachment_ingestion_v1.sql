insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'buyflow-purchase-documents',
  'buyflow-purchase-documents',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.documents
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists content_sha256 text;

create unique index if not exists uq_documents_purchase_provider_attachment
  on public.documents(purchase_id, provider_message_id, attachment_id)
  where provider_message_id is not null and attachment_id is not null;

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_connection_id uuid not null references public.email_connections(id) on delete cascade,
  source_email_id uuid not null references public.source_emails(id) on delete cascade,
  provider_message_id text not null,
  attachment_id text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint,
  storage_bucket text,
  storage_path text,
  content_sha256 text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'review', 'ignored', 'error')),
  extraction_result jsonb,
  last_error_code text,
  attempts integer not null default 0 check (attempts >= 0),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_connection_id, provider_message_id, attachment_id)
);

create index if not exists idx_email_attachments_source
  on public.email_attachments(source_email_id, processing_status);

create index if not exists idx_email_attachments_retry
  on public.email_attachments(processing_status, attempts, updated_at)
  where processing_status in ('pending', 'error');

alter table public.email_attachments enable row level security;

revoke all on table public.email_attachments from public;
revoke all on table public.email_attachments from anon;
revoke all on table public.email_attachments from authenticated;
grant select, insert, update, delete on table public.email_attachments to service_role;

create or replace function public.controlled_upsert_invoice_attachment_document(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_attachment_row_id uuid,
  p_document_number text,
  p_issued_at timestamptz,
  p_provider_message_id text,
  p_attachment_id text,
  p_filename text,
  p_mime_type text,
  p_storage_bucket text,
  p_storage_path text,
  p_content_sha256 text,
  p_confidence numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_user_id uuid;
  v_purchase_order_number text;
  v_source_user_id uuid;
  v_source_provider_message_id text;
  v_source_event_type text;
  v_source_order_number text;
  v_source_invoice_number text;
  v_source_confidence numeric;
  v_attachment_user_id uuid;
  v_attachment_source_email_id uuid;
  v_attachment_provider_message_id text;
  v_attachment_id text;
  v_attachment_filename text;
  v_attachment_mime_type text;
  v_attachment_storage_bucket text;
  v_attachment_storage_path text;
  v_attachment_content_sha256 text;
  v_attachment_status text;
  v_document_id uuid;
begin
  if p_user_id is null or p_purchase_id is null or p_source_email_id is null or p_attachment_row_id is null then
    raise exception 'invoice attachment identity is incomplete';
  end if;

  if nullif(trim(p_document_number), '') is null then
    raise exception 'invoice number is required';
  end if;

  if nullif(trim(p_provider_message_id), '') is null or nullif(trim(p_attachment_id), '') is null then
    raise exception 'provider attachment identity is required';
  end if;

  if lower(trim(coalesce(p_mime_type, ''))) <> 'application/pdf' then
    raise exception 'controlled invoice attachment must be a PDF';
  end if;

  if nullif(trim(p_storage_bucket), '') is null or nullif(trim(p_storage_path), '') is null then
    raise exception 'stored attachment identity is required';
  end if;

  if nullif(trim(p_content_sha256), '') is null or length(trim(p_content_sha256)) <> 64 then
    raise exception 'attachment content hash is required';
  end if;

  if p_confidence is null or p_confidence < 0.95 or p_confidence > 1 then
    raise exception 'attachment invoice confidence is outside the controlled range';
  end if;

  select user_id, order_number
    into v_purchase_user_id, v_purchase_order_number
  from public.purchases
  where id = p_purchase_id;

  if v_purchase_user_id is null or v_purchase_user_id <> p_user_id then
    raise exception 'target purchase does not belong to the target user';
  end if;

  select
    user_id,
    provider_message_id,
    validated_result ->> 'event_type',
    validated_result ->> 'order_number',
    validated_result ->> 'invoice_number',
    nullif(validated_result ->> 'confidence', '')::numeric
  into
    v_source_user_id,
    v_source_provider_message_id,
    v_source_event_type,
    v_source_order_number,
    v_source_invoice_number,
    v_source_confidence
  from public.source_emails
  where id = p_source_email_id;

  if v_source_user_id is null or v_source_user_id <> p_user_id then
    raise exception 'invoice source does not belong to the target user';
  end if;

  if v_source_provider_message_id is distinct from p_provider_message_id then
    raise exception 'provider message identity mismatch';
  end if;

  if v_source_event_type is distinct from 'invoice_or_receipt' then
    raise exception 'source email is not a validated invoice event';
  end if;

  if v_source_confidence is null or v_source_confidence < 0.95 then
    raise exception 'source invoice confidence is too low';
  end if;

  if regexp_replace(upper(coalesce(v_source_order_number, '')), '[^A-Z0-9]', '', 'g')
     is distinct from regexp_replace(upper(coalesce(v_purchase_order_number, '')), '[^A-Z0-9]', '', 'g') then
    raise exception 'source invoice order identity does not match purchase';
  end if;

  if upper(trim(coalesce(v_source_invoice_number, ''))) is distinct from upper(trim(p_document_number)) then
    raise exception 'source invoice number does not match requested document number';
  end if;

  select
    user_id,
    source_email_id,
    provider_message_id,
    attachment_id,
    filename,
    mime_type,
    storage_bucket,
    storage_path,
    content_sha256,
    processing_status
  into
    v_attachment_user_id,
    v_attachment_source_email_id,
    v_attachment_provider_message_id,
    v_attachment_id,
    v_attachment_filename,
    v_attachment_mime_type,
    v_attachment_storage_bucket,
    v_attachment_storage_path,
    v_attachment_content_sha256,
    v_attachment_status
  from public.email_attachments
  where id = p_attachment_row_id;

  if v_attachment_user_id is null or v_attachment_user_id <> p_user_id then
    raise exception 'attachment does not belong to the target user';
  end if;

  if v_attachment_source_email_id is distinct from p_source_email_id
     or v_attachment_provider_message_id is distinct from p_provider_message_id
     or v_attachment_id is distinct from p_attachment_id then
    raise exception 'attachment provenance mismatch';
  end if;

  if v_attachment_filename is distinct from p_filename
     or lower(v_attachment_mime_type) is distinct from lower(p_mime_type)
     or v_attachment_storage_bucket is distinct from p_storage_bucket
     or v_attachment_storage_path is distinct from p_storage_path
     or lower(v_attachment_content_sha256) is distinct from lower(p_content_sha256) then
    raise exception 'attachment storage metadata mismatch';
  end if;

  if v_attachment_status not in ('processing', 'processed') then
    raise exception 'attachment is not in a controlled processing state';
  end if;

  select id into v_document_id
  from public.documents
  where purchase_id = p_purchase_id
    and type = 'invoice'
    and lower(document_number) = lower(trim(p_document_number))
  limit 1;

  if v_document_id is null then
    select id into v_document_id
    from public.documents
    where purchase_id = p_purchase_id
      and provider_message_id = p_provider_message_id
      and attachment_id = p_attachment_id
    limit 1;
  end if;

  if v_document_id is null then
    insert into public.documents (
      purchase_id,
      product_id,
      type,
      document_number,
      issued_at,
      source_type,
      external_url,
      provider_message_id,
      attachment_id,
      filename,
      mime_type,
      storage_bucket,
      storage_path,
      content_sha256
    ) values (
      p_purchase_id,
      null,
      'invoice',
      trim(p_document_number),
      p_issued_at,
      'email_attachment',
      null,
      p_provider_message_id,
      p_attachment_id,
      p_filename,
      p_mime_type,
      p_storage_bucket,
      p_storage_path,
      lower(p_content_sha256)
    )
    returning id into v_document_id;
  else
    update public.documents
    set
      source_type = 'email_attachment',
      provider_message_id = p_provider_message_id,
      attachment_id = p_attachment_id,
      filename = p_filename,
      mime_type = p_mime_type,
      storage_bucket = p_storage_bucket,
      storage_path = p_storage_path,
      content_sha256 = lower(p_content_sha256),
      issued_at = coalesce(issued_at, p_issued_at)
    where id = v_document_id;
  end if;

  insert into public.purchase_sources (
    purchase_id,
    source_email_id,
    relation_type,
    confidence
  ) values (
    p_purchase_id,
    p_source_email_id,
    'document',
    p_confidence
  )
  on conflict (purchase_id, source_email_id)
  do update set
    confidence = greatest(
      coalesce(public.purchase_sources.confidence, 0),
      coalesce(excluded.confidence, 0)
    );

  return v_document_id;
end;
$$;

revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from public;
revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from anon;
revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from authenticated;
grant execute on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) to service_role;
