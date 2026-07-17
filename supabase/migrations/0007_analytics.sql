-- Phase 4: usage analytics + lead attribution.
--
-- First-party, cookieless analytics: a random visitor id lives in the
-- browser's localStorage and a session id in sessionStorage, so there are no
-- third-party trackers and no cookie banner to owe anyone. Every event is
-- written server-side through the Next API route with the service-role key,
-- same trust model as quote_requests. Geo comes from Vercel's edge headers
-- (country/region/city only, never the raw IP).
--
-- This is also the thing that stops data quietly disappearing: page views,
-- funnel steps and submissions are all logged here, so even a lead whose quote
-- fails to save leaves a trail we can see.

create extension if not exists pgcrypto;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- identity (cookieless: random ids from browser storage, not personal)
  visitor_id text,   -- persistent per browser (localStorage)
  session_id text,   -- per visit (sessionStorage)

  -- what happened
  type text not null,        -- page_view | quote_start | quote_step | quote_submit | quote_save_failed | cta_click | ...
  path text,                 -- pathname the event fired on
  referrer text,             -- full referrer as sent by the browser
  referrer_host text,        -- parsed host, for grouping ("google.com")

  -- acquisition (first-touch UTM travels with every event in a session)
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,

  -- where (Vercel edge geo; no raw IP is ever stored)
  country text,
  region text,
  city text,

  -- device
  device text,               -- mobile | tablet | desktop
  user_agent text,

  -- anything event-specific (quote total, step name, postcode area, ...)
  meta jsonb
);

create index if not exists analytics_events_created_at_idx on public.analytics_events (created_at desc);
create index if not exists analytics_events_type_idx on public.analytics_events (type);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id);
create index if not exists analytics_events_visitor_idx on public.analytics_events (visitor_id);
create index if not exists analytics_events_path_idx on public.analytics_events (path);
create index if not exists analytics_events_utm_source_idx on public.analytics_events (utm_source);
create index if not exists analytics_events_referrer_host_idx on public.analytics_events (referrer_host);

alter table public.analytics_events enable row level security;
-- No policies on purpose: only the service role (the /api/track route) writes,
-- and only the service role (the ops dashboard) reads.

-- Lead attribution: remember where every quote request came from, so the
-- marketing spend that produced a booking is knowable. The JSONB carries the
-- full first-touch picture; the two flat columns exist for quick ops queries.
alter table public.quote_requests
  add column if not exists attribution jsonb,
  add column if not exists referrer text,
  add column if not exists utm_source text;
