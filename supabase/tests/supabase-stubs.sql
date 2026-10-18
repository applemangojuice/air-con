-- The slice of a Supabase project our migrations rely on, so they can run
-- against a bare Postgres 16 cluster. Not a migration: test harness only.
--
--  * `storage.buckets`: migrations insert their private buckets here.
--  * `auth`: exists on every Supabase project; nothing of ours uses it yet.
--  * The three API roles, with Supabase's default grants on `public`, so the
--    tests can prove RLS (not missing grants) is what keeps anon out.
--    service_role bypasses RLS, exactly as on Supabase.

create extension if not exists pgcrypto;

create schema if not exists storage;
create schema if not exists auth;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now()
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
