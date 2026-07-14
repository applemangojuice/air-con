-- Phase 1: customer self-survey + fixed-price quotes.
--
-- Design notes:
--  * `survey` and `quote` are stored as JSONB snapshots alongside the engine
--    version, so every historical quote can be replayed against newer engine
--    rules (the knowledge loop depends on this).
--  * Writes go through the Next.js API route using the service-role key;
--    anonymous clients get no direct table access. Photos upload to a private
--    storage bucket via short-lived signed upload URLs minted by the API.

create extension if not exists pgcrypto;

create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- contact
  customer_name text not null,
  email text not null,
  phone text,
  timeframe text, -- 'asap' | '1-3-months' | 'researching'

  -- property
  postcode text not null,
  address_line text not null,

  -- snapshots
  engine_version text not null,
  survey jsonb not null,
  quote jsonb not null,

  -- denormalised for ops queries
  total_gbp integer not null,
  room_count integer not null,
  confidence_score integer not null,
  confidence_band text not null,

  status text not null default 'new' -- new | reviewed | booked | declined
);

create index quote_requests_created_at_idx on public.quote_requests (created_at desc);
create index quote_requests_postcode_idx on public.quote_requests (postcode);
create index quote_requests_status_idx on public.quote_requests (status);

alter table public.quote_requests enable row level security;
-- No policies on purpose: only the service role (API route) can read/write.

-- Private bucket for survey photos.
insert into storage.buckets (id, name, public)
values ('survey-photos', 'survey-photos', false)
on conflict (id) do nothing;
