-- Synthetic disposable PostgreSQL database only.
\set ON_ERROR_STOP on
begin;
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.email_connections (
 id uuid primary key, user_id uuid, provider text, status text, provider_account_id text
);
create table public.source_emails (
 id uuid primary key, user_id uuid not null, email_connection_id uuid,
 provider_message_id text, processing_status text, classification text,
 structured_result jsonb, validated_result jsonb, validation_status text,
 validated_at timestamptz, processed_at timestamptz
);
create table public.ai_processing_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 source_email_id uuid references public.source_emails(id), purpose text, provider text,
 model text not null, prompt_version text, status text, input_tokens integer,
 output_tokens integer, confidence numeric, result jsonb
);
\ir ../migrations/20260812210000_add_webhook_inbox.sql
\ir ../migrations/20260912192905_recoverable_source_extraction.sql
grant select, insert, update on public.source_emails, public.email_connections, public.ai_processing_runs to service_role;
set local role service_role;
do $$
declare
 s uuid := gen_random_uuid(); u uuid := gen_random_uuid(); c uuid := gen_random_uuid();
 a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); event_id uuid;
 payload jsonb := '{"model":"synthetic","confidence":0.9,"result":{}}';
begin
 insert into public.email_connections values(c,u,'nylas','active','synthetic-grant');
 insert into public.source_emails(id,user_id,email_connection_id,provider_message_id,processing_status)
 values(s,u,c,'synthetic-message','pending');
 if not public.claim_source_extraction(s,'pending',a) then raise exception 'first claim failed'; end if;
 if public.claim_source_extraction(s,'processing',b) then raise exception 'active claim stolen'; end if;
 if public.finish_source_extraction(s,b,'{}','{}',payload) then raise exception 'foreign completion'; end if;
 update public.source_emails set processing_started_at=now()-interval '6 minutes' where id=s;
 if public.finish_source_extraction(s,a,'{}','{}',payload) then raise exception 'expired completion'; end if;
 if not public.claim_source_extraction(s,'processing',b) then raise exception 'stale reclaim failed'; end if;
 if public.release_source_extraction(s,a) then raise exception 'old worker released new claim'; end if;
 if public.finish_source_extraction(s,a,'{}','{}',payload) then raise exception 'old worker wrote result'; end if;
 if (select count(*) from public.ai_processing_runs) <> 0 then raise exception 'stale audit inserted'; end if;
 -- A failed audit insert rolls back the entire operation and preserves the claim.
 begin
   perform public.finish_source_extraction(s,b,'{}','{}','{}');
   raise exception 'invalid audit unexpectedly saved';
 exception when not_null_violation then null;
 end;
 if (select processing_claim from public.source_emails where id=s) <> b then raise exception 'failed transaction lost claim'; end if;
 if not public.finish_source_extraction(s,b,'{"event_type":"shipment"}','{"shadow_only":true}',payload) then raise exception 'completion failed'; end if;
 if public.finish_source_extraction(s,b,'{}','{}',payload) then raise exception 'duplicate completion'; end if;
 if (select count(*) from public.ai_processing_runs) <> 1 then raise exception 'duplicate audit'; end if;
 if not exists(select 1 from public.source_emails where id=s and processing_status='review' and processing_claim is null and validated_result->>'shadow_only'='true') then raise exception 'result missing'; end if;
 -- Retry release preserves the previous result; legacy unleased rows recover too.
 if not public.claim_source_extraction(s,'review',a) then raise exception 'reextract failed'; end if;
 if not public.release_source_extraction(s,a) then raise exception 'release failed'; end if;
 if not exists(select 1 from public.source_emails where id=s and processing_status='error' and validated_result is not null) then raise exception 'release lost evidence'; end if;
 update public.source_emails set processing_status='processing', processing_started_at=null where id=s;
 if not public.claim_source_extraction(s,'processing',b) then raise exception 'legacy recovery failed'; end if;
 event_id := public.enqueue_nylas_message_event('synthetic-grant','synthetic-message');
 perform public.finish_webhook_inbox_event(event_id,true);
 if public.requeue_stale_source_extractions() <> 0 then raise exception 'active source requeued'; end if;
 update public.source_emails set processing_started_at=now()-interval '6 minutes' where id=s;
 if public.requeue_stale_source_extractions() <> 1 then raise exception 'lost webhook not recovered'; end if;
 if public.requeue_stale_source_extractions() <> 0 then raise exception 'retry backoff overwritten'; end if;
 if not exists(select 1 from public.webhook_inbox where id=event_id and status='retry') then raise exception 'retry missing'; end if;
 if not public.claim_webhook_inbox_event(event_id) then raise exception 'retry unclaimable'; end if;
 if public.requeue_stale_source_extractions() <> 0 then raise exception 'active webhook stolen'; end if;
end;
$$;
reset role;
do $$
declare role_name text; fn text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  foreach fn in array array['claim_source_extraction(uuid,text,uuid)', 'finish_source_extraction(uuid,uuid,jsonb,jsonb,jsonb)', 'release_source_extraction(uuid,uuid)', 'requeue_stale_source_extractions()'] loop
   if has_function_privilege(role_name,'public.'||fn,'EXECUTE') then raise exception 'client can execute %',fn; end if;
  end loop;
 end loop;
end;
$$;
rollback;
