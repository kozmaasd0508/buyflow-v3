alter table public.source_emails
  drop constraint if exists source_emails_processing_status_check;

alter table public.source_emails
  add constraint source_emails_processing_status_check
  check (processing_status in ('pending','processing','processed','review','unlinked','ignored','error'));
