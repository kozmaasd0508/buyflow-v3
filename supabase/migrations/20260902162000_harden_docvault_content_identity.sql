-- DocVault safety hardening.
-- 1) document ownership must always match the owning Purchase;
-- 2) a hashed/stored document's physical content identity is immutable;
-- 3) an invoice number may be retried idempotently with the same PDF, but a
--    different PDF must fail closed instead of replacing the existing file.

create or replace function public.docvault_enforce_document_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_purchase_user_id uuid;
  v_source_user_id uuid;
begin
  if new.purchase_id is not null then
    select p.user_id
      into v_purchase_user_id
    from public.purchases p
    where p.id = new.purchase_id;

    if v_purchase_user_id is null then
      raise exception 'document purchase does not exist';
    end if;

    if new.user_id is null then
      new.user_id := v_purchase_user_id;
    elsif new.user_id <> v_purchase_user_id then
      raise exception 'document ownership does not match purchase ownership';
    end if;
  end if;

  if new.user_id is null then
    raise exception 'document owner is required';
  end if;

  if new.source_email_id is not null then
    select se.user_id
      into v_source_user_id
    from public.source_emails se
    where se.id = new.source_email_id;

    if v_source_user_id is null or v_source_user_id <> new.user_id then
      raise exception 'document source ownership mismatch';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.docvault_enforce_document_ownership() from public;
revoke all on function public.docvault_enforce_document_ownership() from anon;
revoke all on function public.docvault_enforce_document_ownership() from authenticated;

-- Do not silently repair a cross-user legacy row. Stop the migration and force
-- explicit review if such a row exists.
do $block$
begin
  if exists (
    select 1
    from public.documents d
    join public.purchases p on p.id = d.purchase_id
    where d.user_id <> p.user_id
  ) then
    raise exception 'existing document ownership mismatch requires review';
  end if;
end;
$block$;

drop trigger if exists trg_docvault_enforce_document_ownership on public.documents;
create trigger trg_docvault_enforce_document_ownership
before insert or update of user_id, purchase_id, source_email_id
on public.documents
for each row execute function public.docvault_enforce_document_ownership();

create or replace function public.docvault_guard_document_content_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.content_sha256 is not null then
    if lower(coalesce(new.content_sha256, '')) is distinct from lower(old.content_sha256)
       or new.user_id is distinct from old.user_id
       or new.purchase_id is distinct from old.purchase_id
       or new.source_email_id is distinct from old.source_email_id
       or new.type is distinct from old.type
       or new.document_number is distinct from old.document_number
       or new.source_type is distinct from old.source_type
       or new.provider_message_id is distinct from old.provider_message_id
       or new.attachment_id is distinct from old.attachment_id
       or new.filename is distinct from old.filename
       or new.mime_type is distinct from old.mime_type
       or new.storage_bucket is distinct from old.storage_bucket
       or new.storage_path is distinct from old.storage_path then
      raise exception 'hashed document content identity is immutable';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.docvault_guard_document_content_identity() from public;
revoke all on function public.docvault_guard_document_content_identity() from anon;
revoke all on function public.docvault_guard_document_content_identity() from authenticated;

drop trigger if exists trg_docvault_guard_document_content_identity on public.documents;
create trigger trg_docvault_guard_document_content_identity
before update on public.documents
for each row execute function public.docvault_guard_document_content_identity();

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
set search_path = ''
as $function$
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
  v_document_user_id uuid;
  v_document_purchase_id uuid;
  v_document_type text;
  v_document_number text;
  v_document_content_sha256 text;
begin
  if p_user_id is null or p_purchase_id is null or p_source_email_id is null or p_attachment_row_id is null then
    raise exception 'invoice attachment identity is incomplete';
  end if;

  if nullif(btrim(p_document_number), '') is null then
    raise exception 'invoice number is required';
  end if;

  if nullif(btrim(p_provider_message_id), '') is null or nullif(btrim(p_attachment_id), '') is null then
    raise exception 'provider attachment identity is required';
  end if;

  if lower(btrim(coalesce(p_mime_type, ''))) <> 'application/pdf' then
    raise exception 'controlled invoice attachment must be a PDF';
  end if;

  if nullif(btrim(p_storage_bucket), '') is null or nullif(btrim(p_storage_path), '') is null then
    raise exception 'stored attachment identity is required';
  end if;

  if p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'attachment content hash is required';
  end if;

  if p_confidence is null or p_confidence < 0.95 or p_confidence > 1 then
    raise exception 'attachment invoice confidence is outside the controlled range';
  end if;

  select p.user_id, p.order_number
    into v_purchase_user_id, v_purchase_order_number
  from public.purchases p
  where p.id = p_purchase_id;

  if v_purchase_user_id is null or v_purchase_user_id <> p_user_id then
    raise exception 'target purchase does not belong to the target user';
  end if;

  select
    se.user_id,
    se.provider_message_id,
    se.validated_result ->> 'event_type',
    se.validated_result ->> 'order_number',
    se.validated_result ->> 'invoice_number',
    nullif(se.validated_result ->> 'confidence', '')::numeric
  into
    v_source_user_id,
    v_source_provider_message_id,
    v_source_event_type,
    v_source_order_number,
    v_source_invoice_number,
    v_source_confidence
  from public.source_emails se
  where se.id = p_source_email_id;

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

  if pg_catalog.regexp_replace(upper(coalesce(v_source_order_number, '')), '[^A-Z0-9]', '', 'g')
     is distinct from pg_catalog.regexp_replace(upper(coalesce(v_purchase_order_number, '')), '[^A-Z0-9]', '', 'g') then
    raise exception 'source invoice order identity does not match purchase';
  end if;

  if upper(btrim(coalesce(v_source_invoice_number, ''))) is distinct from upper(btrim(p_document_number)) then
    raise exception 'source invoice number does not match requested document number';
  end if;

  select
    ea.user_id,
    ea.source_email_id,
    ea.provider_message_id,
    ea.attachment_id,
    ea.filename,
    ea.mime_type,
    ea.storage_bucket,
    ea.storage_path,
    ea.content_sha256,
    ea.processing_status
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
  from public.email_attachments ea
  where ea.id = p_attachment_row_id;

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

  select
    d.id,
    d.user_id,
    d.purchase_id,
    d.type,
    d.document_number,
    d.content_sha256
  into
    v_document_id,
    v_document_user_id,
    v_document_purchase_id,
    v_document_type,
    v_document_number,
    v_document_content_sha256
  from public.documents d
  where d.purchase_id = p_purchase_id
    and d.type = 'invoice'
    and lower(d.document_number) = lower(btrim(p_document_number))
  limit 1
  for update;

  if v_document_id is null then
    select
      d.id,
      d.user_id,
      d.purchase_id,
      d.type,
      d.document_number,
      d.content_sha256
    into
      v_document_id,
      v_document_user_id,
      v_document_purchase_id,
      v_document_type,
      v_document_number,
      v_document_content_sha256
    from public.documents d
    where d.purchase_id = p_purchase_id
      and d.provider_message_id = p_provider_message_id
      and d.attachment_id = p_attachment_id
    limit 1
    for update;
  end if;

  if v_document_id is null then
    insert into public.documents (
      user_id,
      purchase_id,
      product_id,
      source_email_id,
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
      p_user_id,
      p_purchase_id,
      null,
      p_source_email_id,
      'invoice',
      btrim(p_document_number),
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
    if v_document_user_id <> p_user_id
       or v_document_purchase_id <> p_purchase_id
       or v_document_type <> 'invoice'
       or lower(coalesce(v_document_number, '')) is distinct from lower(btrim(p_document_number)) then
      raise exception 'existing invoice document identity mismatch';
    end if;

    if v_document_content_sha256 is not null
       and lower(v_document_content_sha256) is distinct from lower(p_content_sha256) then
      raise exception 'document content hash conflict';
    end if;

    -- A body-only placeholder may be upgraded exactly once to a physical PDF.
    -- Once a content hash exists, physical provenance stays immutable. Repeated
    -- copies of the same invoice are represented by purchase_sources instead.
    if v_document_content_sha256 is null then
      update public.documents d
      set
        user_id = p_user_id,
        source_email_id = p_source_email_id,
        source_type = 'email_attachment',
        provider_message_id = p_provider_message_id,
        attachment_id = p_attachment_id,
        filename = p_filename,
        mime_type = p_mime_type,
        storage_bucket = p_storage_bucket,
        storage_path = p_storage_path,
        content_sha256 = lower(p_content_sha256),
        issued_at = coalesce(d.issued_at, p_issued_at)
      where d.id = v_document_id;
    else
      update public.documents d
      set issued_at = coalesce(d.issued_at, p_issued_at)
      where d.id = v_document_id;
    end if;
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
    relation_type = 'document',
    confidence = greatest(
      coalesce(public.purchase_sources.confidence, 0),
      coalesce(excluded.confidence, 0)
    );

  return v_document_id;
end;
$function$;

revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from public;
revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from anon;
revoke all on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) from authenticated;
grant execute on function public.controlled_upsert_invoice_attachment_document(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text,text,text,numeric) to service_role;
