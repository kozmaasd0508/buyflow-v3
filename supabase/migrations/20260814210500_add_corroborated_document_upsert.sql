create or replace function public.controlled_upsert_corroborated_document_with_source(
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
set search_path = ''
as $$
declare
  v_purchase_user_id uuid;
  v_purchase_order_number text;
  v_source_user_id uuid;
  v_source_provider_message_id text;
  v_source_validation_status text;
  v_source_event_type text;
  v_source_order_number text;
  v_source_invoice_number text;
  v_source_confidence numeric;
  v_link_relation_type text;
  v_link_confidence numeric;
  v_document_id uuid;
begin
  if p_user_id is null or p_purchase_id is null or p_source_email_id is null then
    raise exception 'corroborated document identity is incomplete';
  end if;

  if p_document_type <> 'invoice' then
    raise exception 'corroborated document type is not allowed';
  end if;

  if nullif(btrim(p_document_number), '') is null then
    raise exception 'corroborated invoice number is required';
  end if;

  if nullif(btrim(p_provider_message_id), '') is null then
    raise exception 'corroborated provider message id is required';
  end if;

  if p_confidence is null or p_confidence < 0.65 or p_confidence >= 0.85 then
    raise exception 'corroborated document confidence is outside the allowed range';
  end if;

  select p.user_id, p.order_number
    into v_purchase_user_id, v_purchase_order_number
  from public.purchases p
  where p.id = p_purchase_id;

  if v_purchase_user_id is null or v_purchase_user_id <> p_user_id then
    raise exception 'corroborated document purchase ownership mismatch';
  end if;

  select
    se.user_id,
    se.provider_message_id,
    coalesce(se.validated_result ->> 'validation_status', se.validation_status),
    se.validated_result ->> 'event_type',
    se.validated_result ->> 'order_number',
    se.validated_result ->> 'invoice_number',
    nullif(se.validated_result ->> 'confidence', '')::numeric
  into
    v_source_user_id,
    v_source_provider_message_id,
    v_source_validation_status,
    v_source_event_type,
    v_source_order_number,
    v_source_invoice_number,
    v_source_confidence
  from public.source_emails se
  where se.id = p_source_email_id;

  if v_source_user_id is null or v_source_user_id <> p_user_id then
    raise exception 'corroborated document source ownership mismatch';
  end if;

  if v_source_provider_message_id is distinct from p_provider_message_id then
    raise exception 'corroborated provider message identity mismatch';
  end if;

  if v_source_validation_status is distinct from 'validated' then
    raise exception 'corroborated document source must be validated';
  end if;

  if v_source_event_type is distinct from 'invoice_or_receipt' then
    raise exception 'corroborated document source is not an invoice event';
  end if;

  if v_source_confidence is null or v_source_confidence < 0.65 or v_source_confidence >= 0.85 then
    raise exception 'corroborated source confidence is outside the allowed range';
  end if;

  if regexp_replace(upper(coalesce(v_source_order_number, '')), '[^A-Z0-9]', '', 'g')
     is distinct from regexp_replace(upper(coalesce(v_purchase_order_number, '')), '[^A-Z0-9]', '', 'g')
     or length(regexp_replace(upper(coalesce(v_source_order_number, '')), '[^A-Z0-9]', '', 'g')) < 6 then
    raise exception 'corroborated source order identity does not match purchase';
  end if;

  if upper(btrim(coalesce(v_source_invoice_number, ''))) is distinct from upper(btrim(p_document_number)) then
    raise exception 'corroborated source invoice number mismatch';
  end if;

  select ps.relation_type, ps.confidence
    into v_link_relation_type, v_link_confidence
  from public.purchase_sources ps
  where ps.purchase_id = p_purchase_id
    and ps.source_email_id = p_source_email_id;

  if v_link_relation_type not in ('invoice_or_receipt', 'document')
     or v_link_confidence is null
     or v_link_confidence < 0.65 then
    raise exception 'invoice source is not already corroborated to the purchase';
  end if;

  if not exists (
    select 1
    from public.purchase_sources ps
    join public.source_emails se on se.id = ps.source_email_id
    where ps.purchase_id = p_purchase_id
      and ps.source_email_id <> p_source_email_id
      and ps.relation_type in ('order_created', 'order_updated', 'shipment', 'delivery')
      and coalesce(ps.confidence, 0) >= 0.70
      and coalesce(se.validated_result ->> 'validation_status', se.validation_status) in ('validated', 'guardrailed')
      and se.validated_result ->> 'event_type' = ps.relation_type
  ) then
    raise exception 'corroborated invoice lacks independent purchase lifecycle evidence';
  end if;

  select d.id
    into v_document_id
  from public.documents d
  where d.purchase_id = p_purchase_id
    and d.type = 'invoice'
    and lower(d.document_number) = lower(btrim(p_document_number))
  limit 1;

  if v_document_id is null then
    select d.id
      into v_document_id
    from public.documents d
    where d.purchase_id = p_purchase_id
      and d.type = 'invoice'
      and d.provider_message_id = p_provider_message_id
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
        'invoice',
        btrim(p_document_number),
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
      select d.id
        into v_document_id
      from public.documents d
      where d.purchase_id = p_purchase_id
        and d.type = 'invoice'
        and (
          lower(d.document_number) = lower(btrim(p_document_number))
          or d.provider_message_id = p_provider_message_id
        )
      order by d.created_at
      limit 1;
    end;
  end if;

  if v_document_id is null then
    raise exception 'corroborated document could not be created or resolved idempotently';
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
$$;

revoke all on function public.controlled_upsert_corroborated_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from public;
revoke all on function public.controlled_upsert_corroborated_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from anon;
revoke all on function public.controlled_upsert_corroborated_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) from authenticated;
grant execute on function public.controlled_upsert_corroborated_document_with_source(uuid,uuid,uuid,text,text,timestamptz,text,numeric) to service_role;
