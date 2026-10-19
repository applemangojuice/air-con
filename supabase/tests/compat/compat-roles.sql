-- The rest of a Supabase project's role set-up, on top of
-- supabase-stubs.sql (which creates anon / authenticated / service_role, the
-- storage and auth schemas and their default grants). Run by the cluster's
-- superuser, `supabase_admin` as on Supabase. Test harness only.
--
--  * `postgres`: who migrations run as. On Supabase it is NOT a superuser
--    (CREATEROLE CREATEDB REPLICATION BYPASSRLS), owns the public schema and
--    may write storage.buckets, so a migration that needs more than that
--    fails here as it would in the SQL editor.
--  * Objects postgres creates in public are granted to the API roles by
--    default, as Supabase's default privileges do.
--  * `authenticator`: the one login role PostgREST connects as. It has no
--    rights of its own (noinherit) and switches to the role named in the
--    request's JWT: anon, authenticated or service_role.
--  * service_role bypasses RLS (BYPASSRLS), so with RLS on and no policies
--    it sees and writes everything while anon sees nothing.
--  * The statement timeouts Supabase sets: 8 s for API requests (the
--    authenticator's, which service_role keeps), 3 s for anon.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres login nosuperuser createdb createrole replication bypassrls password 'compat-postgres';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'compat-authenticator';
  end if;
end
$$;

alter schema public owner to postgres;
grant usage on schema storage to postgres;
grant all on storage.buckets to postgres;
grant usage on schema auth to postgres;
grant anon, authenticated, service_role to postgres;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

alter role authenticator with noinherit login password 'compat-authenticator';
grant anon, authenticated, service_role to authenticator;
alter role service_role bypassrls;

alter role authenticator set statement_timeout = '8s';
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
