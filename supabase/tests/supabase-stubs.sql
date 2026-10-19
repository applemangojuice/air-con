-- The slice of a Supabase project our migrations rely on, so they can run
-- against a bare Postgres 16 cluster. Not a migration: test harness only.
--
--  * `storage.buckets`: migrations insert their private buckets here.
--  * `auth`: exists on every Supabase project; nothing of ours uses it yet.
--  * The three API roles, with Supabase's default grants on `public` as a
--    project created today has them: usage on the schema, functions and
--    sequences, but no longer tables (Supabase stopped exposing new tables to
--    its API roles by default: new projects since 30 May 2026, existing ones
--    from 30 October 2026). So every table the app uses must be granted by
--    the migrations themselves (0014), and a missing grant fails here as it
--    would on Supabase. service_role bypasses RLS, exactly as on Supabase.
--    run-migrations.sh's second database models an older project instead:
--    0001 to 0009 made while tables were still granted by default, then the
--    switch, then the pilot upgrade.

create extension if not exists pgcrypto;

create schema if not exists storage;
create schema if not exists auth;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now(),
  -- As on Supabase: the per-file ceiling and the types a bucket stores (0011).
  file_size_limit bigint,
  allowed_mime_types text[]
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
-- No "grant all on tables" default any more (see above).
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
