-- Phase 3: the Property Intelligence Engine.
--
-- One master record per property, keyed on UPRN where the EPC provides it
-- and a stable synthetic address key where it doesn't. The `intel` JSONB
-- column is the truth (the @aircon/domain PropertyIntel type, stored as-is);
-- the flat columns are denormalised for the analytics filters and are
-- recomputed on every save so they can never drift.

create table public.properties (
  id text primary key, -- UPRN or synthetic addr-... key
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- the snapshot (source of truth)
  intel jsonb not null,

  -- denormalised for filters and list views
  uprn text,
  address_line text not null,
  address_key text not null, -- normalised address + postcode, dataset join key
  postcode text not null,
  outcode text not null, -- SW16, SW17: the unit of rollout
  archetype_id text,
  archetype_confidence integer not null default 0,
  planning_risk text not null default 'none', -- none | check | high
  has_loft_conversion boolean not null default false,
  epc_rating text,
  floor_area_m2 integer,
  audited boolean not null default false,
  priority_score integer not null default 0,
  priority_band text not null default 'low', -- hot | warm | standard | low | exclude
  lead_status text not null default 'untouched',
  campaign text
);

create index properties_outcode_idx on public.properties (outcode);
create index properties_postcode_idx on public.properties (postcode);
create index properties_address_key_idx on public.properties (address_key);
create index properties_archetype_idx on public.properties (archetype_id);
create index properties_priority_idx on public.properties (priority_band, priority_score desc);
create index properties_lead_status_idx on public.properties (lead_status);
create index properties_campaign_idx on public.properties (campaign);

-- Every assessment ever made about a property: ETL imports, manual audits,
-- reclassifications, install learnings. Append-only.
create table public.property_assessments (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id),
  created_at timestamptz not null default now(),
  source text not null, -- epc-import | planning-import | constraints-import | audit | install
  assessment jsonb not null
);

create index property_assessments_property_idx on public.property_assessments (property_id, created_at desc);

alter table public.properties enable row level security;
alter table public.property_assessments enable row level security;
-- No policies on purpose: only the service role (API routes / ops / importer)
-- touches these tables.
