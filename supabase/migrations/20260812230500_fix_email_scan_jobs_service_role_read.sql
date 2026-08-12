revoke all on table public.email_scan_jobs from anon, authenticated;
grant select on table public.email_scan_jobs to service_role;
