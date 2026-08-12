alter table public.documents
  drop constraint if exists documents_source_type_check;

alter table public.documents
  add constraint documents_source_type_check
  check (source_type in ('email_attachment', 'email_body', 'external_url', 'generated'));

create unique index if not exists uq_documents_purchase_type_number
  on public.documents(purchase_id, type, lower(document_number))
  where document_number is not null;

create unique index if not exists uq_documents_purchase_provider_type
  on public.documents(purchase_id, type, provider_message_id)
  where provider_message_id is not null;

create or replace function public.controlled_upsert_document_with_source(
  p_user_id uuid,
  p_purchase_id uuid,
  p_source_email_id uuid,
  p_document_type text,
  p_document_number text,
  p_issued_at timestamptz,
  p_provider_message_id text,
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
  v_document_id uuid;
begin
  if p_user_id is null or p_purchase_id is null or p_source_email_id is null then
    raise exception 'document identity is incomplete';
  end if;

  if p_document_type not in ('invoice', 'receipt') then
    raise exception 'controlled document type is not allowed';
  end if;

  if p_document_type = 'invoice' and nullif(trim(p_document_number), '') is null then
    raise exception 'invoice number is required';
  end if;

  if nullif(trim(p_provider_message_id), '') is null then
    raise exception 'provider message id is required';
  end if;

  if p_confidence is null or p_confidence < 0.85 or p_confidence > 1 then
    raise exception 'document confidence is outside the controlled range';
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
    raise exception 'document source does not belong to the target user';
  end if;

  if v_source_provider_message_id is distinct from p_provider_message_id then
    raise exception 'provider message identity mismatch';
  end if;

  if v_source_event_type is distinct from 'invoice_or_receipt' then
    raise exception 'source email is not a validated document event';
  end if;

  if v_source_confidence is null or v_source_confidence < 0.85 then
    raise exception 'source email document confidence is too low';
  end if;

  if regexp_replace(upper(coalesce(v_source_order_number, '')), '\s+', '', 'g')
     is distinct from regexp_replace(upper(coalesce(v_purchase_order_number, '')), '\s+', '', 'g') then
    raise exception 'source email order identity does not match purchase';
  end if;

  if p_document_type = 'invoice'
     and upper(trim(coalesce(v_source_invoice_number, ''))) is distinct from upper(trim(p_document_number)) then
    raise exception 'source invoice number does not match requested document number';
  end if;

  if p_document_number is not null then
    select id
      into v_document_id
    from public.documents
    where purchase_id = p_purchase_id
      and type = p_document_type
      and lower(document_number) = lower(trim(p_document_number))
    limit 1;
  end if;

  if v_document_id is null then
    select id
      into v_document_id
    from public.documents
    where purchase_id = p_purchase_id
      and type = p_document_type
      and provider_message_id = p_provider_message_id
    limit 1;
  end if;

  if v_document_id is null then
    begin
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
        mime_type
      ) values (
        p_purchase_id,
        null,
        p_document_type,
        nullif(trim(p_document_number), ''),
        p_issued_at,
        'email_body',
        null,
        p_provider_message_id,
        null,
        null,
        null
      )
      returning id into v_document_id;
    exception when unique_violation then
      if p_document_number is not null then
        select id
          into v_document_id
        from public.documents
        where purchase_id = p_purchase_id
          and type = p_document_type
          and lower(document_number) = lower(trim(p_document_number))
        limit 1;
      end if;

      if v_document_id is null then
        select id
          into v_document_id
        from public.documents
        where purchase_id = p_purchase_id
          and type = p_document_type
          and provider_message_id = p_provider_message_id
        limit 1;
      end if;
    end;
  end if;

  if v_document_id is null then
    raise exception 'document could not be created or resolved idempotently';
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

revoke all on function public.controlled_upsert_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from public;
revoke all on function public.controlled_upsert_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from anon;
revoke all on function public.controlled_upsert_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from authenticated;
grant execute on function public.controlled_upsert_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) to service_role;
