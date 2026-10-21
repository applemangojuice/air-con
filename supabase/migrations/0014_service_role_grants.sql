-- The server's access to its tables, granted explicitly (final pre-launch pass).
--
-- The app reaches the database only through Supabase's API (PostgREST) with
-- the service-role key. Until 2026 every new table in `public` was granted to
-- Supabase's API roles (anon, authenticated, service_role) by default, so no
-- migration here granted anything. Supabase has since stopped doing that
-- ("Tables not exposed to Data and GraphQL API automatically"): projects
-- created since 30 May 2026 grant nothing on a new table, and existing
-- projects stop granting tables made after 30 October 2026. A table without
-- the grant answers 42501 "permission denied" even for the service role
-- (which bypasses row level security, but still needs the privilege), so on
-- such a project nobody could sign in and nothing could be saved.
--
-- This grants the service role what the app does to every table and
-- sequence in `public`, whichever migration made it (the original site's
-- 0001 to 0009 too, for a brand-new project), and nothing to anon or
-- authenticated: row level security stays on with no policies, and the
-- public key is never used. Grants are idempotent, so this is safe to re-run,
-- and on an older project that already has them it changes nothing.
--
-- A later migration that creates a table grants it in the same file
-- (apps/web/tests/pilot-upgrade.test.ts insists), and check-schema.sql
-- checks the service role can use every table.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
