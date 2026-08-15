-- email_oauth_states is server-only. Client roles must not access it directly.
revoke all privileges on table public.email_oauth_states from anon;
revoke all privileges on table public.email_oauth_states from authenticated;

-- The BuyFlow API uses service_role to create, consume and clean up short-lived OAuth states.
revoke all privileges on table public.email_oauth_states from service_role;
grant select, insert, delete on table public.email_oauth_states to service_role;
