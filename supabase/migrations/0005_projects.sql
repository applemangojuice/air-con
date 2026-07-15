-- Phase 2: the project workflow, everything after the instant quote.
--
-- A project is the customer's journey on one timeline:
--   quote → floor plan → final quote → site visit → delivery → installation
--
-- Design notes (same philosophy as quote_requests):
--  * `project` is the full JSONB snapshot of the @aircon/domain Project type.
--    Every transition goes through the pure reducer server-side; the row is
--    replaced wholesale. History lives in project->'events'.
--  * Denormalised columns exist purely for ops queries and list views.
--  * One project per quote (unique quote_id). POST /api/projects is
--    idempotent.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quote_requests (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- the snapshot (source of truth)
  project jsonb not null,

  -- denormalised for ops list views
  customer_name text not null,
  postcode text not null,
  current_stage text not null,      -- quote | floor-plan | final-quote | site-visit | delivery | installation
  completed boolean not null default false,
  site_visit_at timestamptz,
  delivery_expected_on date,
  install_on date
);

create index projects_created_at_idx on public.projects (created_at desc);
create index projects_current_stage_idx on public.projects (current_stage);
create index projects_install_on_idx on public.projects (install_on);

alter table public.projects enable row level security;
-- No policies on purpose: only the service role (API routes / ops) touches it.
