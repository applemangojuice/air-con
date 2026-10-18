-- Pilot platform: everything the first four installs run on, from the home
-- survey to aftercare (docs/pilot-architecture.md §E, the binding contract).
--
-- Design notes (same philosophy as quote_requests and projects):
--  * Snapshot is truth. Each table carries the @aircon/domain object as JSONB
--    (`record`, `item`, `po`, `issue`, ...) and a handful of typed columns that
--    exist purely for filters, joins, uniqueness and list views. Repositories
--    (apps/web/lib/repo) map rows <-> domain types in one place and rewrite
--    the typed columns on every save so they can't drift.
--  * Money is integer pence (`..._pence`). Legacy quote fields stay GBP.
--  * Service role only: RLS is enabled on every table with no policies, so the
--    anon and authenticated keys see nothing. Every read and write goes through
--    Next.js server code that checks the signed session first (§C).
--  * Every project-owned row cascades with its project, so deleting a test or
--    demo project leaves nothing behind.
--  * Re-runnable: `if not exists` everywhere Postgres allows it, `create or
--    replace` for functions, drop-then-create for triggers. supabase/tests
--    applies this file twice to prove it.
--  * apps/web/lib/db/local-schema.ts mirrors the unique constraints, defaults
--    and the proposal guard below for the file/memory backend. Keep the two in
--    step.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- People and access
-- ---------------------------------------------------------------------------

-- Everyone who works on a job: our team and subcontractors (`external`).
-- Roles drive permissions (domain staff.ts `can()`); qualifications drive
-- who may sign off F-gas, electrical and commissioning steps.
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  email text not null unique,         -- sign-in identity (magic link)
  name text not null,
  phone text,
  roles text[] not null default '{}', -- admin | surveyor | tech-lead | installer | electrician
  external boolean not null default false,
  active boolean not null default true,
  qualifications jsonb not null default '[]', -- Qualification[]
  bio text,
  photo_media_id uuid,                -- soft reference into media (no project)
  demo boolean not null default false -- DEMO staff from the "Try as..." sign-in
);

create index if not exists staff_active_idx on public.staff (active);

-- The household. One customer can own several projects (more homes, later
-- jobs); the portal session lists them. Consents are recorded separately:
-- operational messages and marketing are different permissions.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  email text not null unique,
  name text, -- may arrive late, like quote_requests.customer_name
  phone text,
  ops_consent jsonb,      -- { at, source, text }: null means never recorded
  marketing_consent jsonb -- same shape; null means no
);

-- Magic links. Only sha256(token) is stored, so a database leak can't be
-- replayed. Single use: `used_at` is stamped when the link is exchanged.
create table if not exists public.login_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  token_hash text not null unique,
  subject_kind text not null check (subject_kind in ('staff', 'customer')),
  subject_id text, -- staff.id or customers.id (polymorphic, so no FK); null for a first admin sign-in
  email text not null,
  purpose text not null default 'login',
  next_path text,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists login_tokens_expires_at_idx on public.login_tokens (expires_at);
create index if not exists login_tokens_subject_idx on public.login_tokens (subject_kind, subject_id);

-- ---------------------------------------------------------------------------
-- Projects: v2 columns
-- ---------------------------------------------------------------------------

-- The `project` JSONB snapshot moves to schema v2 (migrated on read, so v1
-- rows stay valid and `schema_version` records what's actually stored). The
-- flat columns power the ops board: who owns it, what's next and when, what
-- it's worth, and whether something is blocking it. `quote_id` stays.
alter table public.projects
  add column if not exists schema_version int not null default 1,
  add column if not exists customer_id uuid references public.customers (id) on delete set null,
  add column if not exists pilot_number int,
  add column if not exists owner_staff_id uuid references public.staff (id) on delete set null,
  add column if not exists next_action text,
  add column if not exists next_action_at date,
  add column if not exists value_pence int,
  add column if not exists blocked boolean not null default false;

create index if not exists projects_customer_idx on public.projects (customer_id);
create index if not exists projects_owner_staff_idx on public.projects (owner_staff_id);
create index if not exists projects_pilot_number_idx on public.projects (pilot_number);

-- The "what do I chase today?" scan, as on quote_requests (0009).
create index if not exists projects_next_action_idx
  on public.projects (next_action_at)
  where next_action_at is not null;

-- ---------------------------------------------------------------------------
-- Survey, design, proposal
-- ---------------------------------------------------------------------------

-- Every photo, signature and document image, in the private project-media
-- bucket. Annotations are normalised 0..1 shapes drawn over the image;
-- `annotations_version` increments on every save so concurrent editors can
-- detect a stale write. `locked` freezes media a signed record depends on.
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- null only for staff media (profile photos, qualification certificates)
  project_id uuid references public.projects (id) on delete cascade,

  bucket text not null default 'project-media',
  storage_path text not null,
  content_type text not null,
  tag text not null default 'other', -- PhotoTag
  room_id text,                      -- MeasuredRoom.id within the survey
  caption text,
  source text not null,              -- customer | survey | install | handover | ops
  taken_by jsonb,                    -- { kind, id?, name? }
  taken_at timestamptz not null default now(),
  customer_visible boolean not null default false,
  width int,
  height int,
  annotations jsonb not null default '[]',
  annotations_version int not null default 0,
  locked boolean not null default false
);

create index if not exists media_project_idx on public.media (project_id, created_at desc);
create index if not exists media_project_tag_idx on public.media (project_id, tag);

-- The measured survey from the home visit, versioned (a re-survey is a new
-- version; the self-survey on quote_requests is never overwritten).
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1 check (version >= 1),
  status text not null default 'draft', -- draft | submitted

  data jsonb not null default '{}', -- MeasuredSurvey
  surveyor jsonb,                   -- { staffId, name }
  started_at timestamptz,
  submitted_at timestamptz,
  minutes int check (minutes >= 0)
);

create index if not exists surveys_project_idx on public.surveys (project_id, version desc);
create index if not exists surveys_status_idx on public.surveys (status);

-- The engineered design (DesignRecord): systems, units, BOM, overrides with
-- reasons, and the qualified sign-off. One row per version.
create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1 check (version >= 1),
  status text not null default 'draft', -- draft | in-review | approved | superseded

  record jsonb not null default '{}', -- DesignRecord

  unique (project_id, version)
);

create index if not exists designs_project_idx on public.designs (project_id, version desc);
create index if not exists designs_status_idx on public.designs (status);

-- The customer proposal (ProposalRecord): options, cost build-up, tax,
-- discount and, once signed, the acceptance record. An accepted proposal is
-- the contract, so the trigger below makes it immutable.
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1 check (version >= 1),
  -- Checked because the immutability trigger keys off these exact values.
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'accepted', 'declined', 'superseded', 'expired')),

  record jsonb not null default '{}', -- ProposalRecord
  issued_at timestamptz,
  accepted_at timestamptz,

  unique (project_id, version)
);

create index if not exists proposals_project_idx on public.proposals (project_id, version desc);
create index if not exists proposals_status_idx on public.proposals (status);

-- Once a proposal is accepted, what the customer agreed to never changes.
-- The one permitted update is superseding it (a revision becomes the live
-- version), which may touch status and bookkeeping in the record (e.g.
-- `supersededBy`) but never the options, the acceptance record, or which
-- project/version/time it was accepted for. Changes go into a new version.
--
-- A proposal that was accepted and then superseded stays frozen the same way:
-- otherwise accepted -> superseded -> edit would be a way round the rule.
--
-- Deletes aren't blocked, so a project (and its proposals) can still be
-- removed, e.g. demo data or an erasure request.
create or replace function public.proposals_guard_accepted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'accepted'
     or (old.status = 'superseded' and jsonb_typeof(old.record -> 'acceptance') = 'object') then
    if new.status is distinct from 'superseded'
       or new.record -> 'options' is distinct from old.record -> 'options'
       or new.record -> 'acceptance' is distinct from old.record -> 'acceptance'
       or new.project_id is distinct from old.project_id
       or new.version is distinct from old.version
       or new.accepted_at is distinct from old.accepted_at then
      raise exception 'proposal % is accepted and can''t be changed (only superseded)', old.id
        using hint = 'Create a new proposal version instead.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists proposals_guard_accepted on public.proposals;
create trigger proposals_guard_accepted
  before update on public.proposals
  for each row execute function public.proposals_guard_accepted();

-- The equipment, materials and labour catalogue. Ids are stable text keys
-- (seeded from docs/research/data/catalogue-seed.json and CSV imports), so
-- re-imports upsert in place. `cost_pence` is null when we have no
-- trustworthy price yet: unpriced, not free.
create table if not exists public.catalogue_items (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  kind text not null, -- indoor | outdoor | material | labour | tool | service
  manufacturer text,
  series text,
  model text,
  label text not null,
  tier text,          -- standard | premium
  cost_pence int,
  status text not null default 'available',     -- available | uncertain | discontinued
  confidence text not null default 'provisional', -- verified | provisional | stale
  active boolean not null default true,

  item jsonb not null default '{}' -- CatalogueItem
);

create index if not exists catalogue_items_kind_idx on public.catalogue_items (kind, active);
create index if not exists catalogue_items_model_idx on public.catalogue_items (model);

-- Which indoor units an outdoor unit can drive (CompatibilityRule).
create table if not exists public.catalogue_compatibility (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  outdoor_model text not null,
  rule jsonb not null default '{}' -- CompatibilityRule
);

create index if not exists catalogue_compatibility_outdoor_idx on public.catalogue_compatibility (outdoor_model);

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

-- Kit orders, one per supplier per project (PurchaseOrder): lines, receipts,
-- inspection and the status history.
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  supplier text not null,
  status text not null default 'required', -- required | approved | ordered | confirmed | dispatched | delivered | inspected | cancelled

  po jsonb not null default '{}' -- PurchaseOrder
);

create index if not exists purchase_orders_project_idx on public.purchase_orders (project_id, created_at desc);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status);

-- The per-project compliance checklist (ComplianceItem), instantiated from
-- the domain template. One row per template key per project.
create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  key text not null,
  status text not null default 'not-started', -- ComplianceStatus
  statutory boolean not null default false,

  item jsonb not null default '{}', -- ComplianceItem

  unique (project_id, key)
);

create index if not exists compliance_items_status_idx on public.compliance_items (status);

-- The install job (InstallJobV2): runsheet, step outcomes, tech-lead
-- exception reviews, QA and the commissioning record. One per project.
-- Evidence lives in install_evidence, not here, so offline captures from
-- several phones never overwrite each other.
create table if not exists public.install_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null unique references public.projects (id) on delete cascade,
  design_id uuid, -- the approved design the runsheet was built from
  template_version text,

  runsheet jsonb not null default '[]',          -- InstallStep[]
  step_statuses jsonb not null default '[]',     -- StepStatusRecord[]
  exception_reviews jsonb not null default '[]', -- ExceptionReview[]
  commissioning jsonb,                           -- CommissioningRecord, once signed
  qa jsonb not null default '{}'                 -- { status, reviewedBy?, note? }
);

-- Every reading, photo, serial and signature captured on site. Append-only.
-- The id is generated on the phone, so an offline retry of the same capture
-- is a primary-key conflict (ignored), never a duplicate. No FK on media_id:
-- the photo and the evidence row may sync in either order.
create table if not exists public.install_evidence (
  id text primary key,
  created_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  spec_id text not null,
  value numeric, -- numeric readings (bar, microns, kW, dB)
  ref text,      -- serials, scan refs
  note text,
  media_id uuid,
  by_staff_id uuid,
  by_name text not null,
  at timestamptz not null, -- stamped on capture, not on sync
  gps jsonb                -- { lat, lng }
);

create index if not exists install_evidence_project_idx on public.install_evidence (project_id, at);
create index if not exists install_evidence_spec_idx on public.install_evidence (project_id, spec_id);

-- Defects, snags, shortages, blockers and variations (Issue). `number` is
-- the human-friendly per-project counter ("Issue #3").
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  number int not null check (number >= 1),
  kind text not null,                      -- IssueKind
  status text not null default 'open',     -- IssueStatus
  severity text not null default 'medium', -- low | medium | high | critical
  blocking boolean not null default false,

  issue jsonb not null default '{}' -- Issue
);

create index if not exists issues_project_idx on public.issues (project_id, number);
create index if not exists issues_status_idx on public.issues (status);
create index if not exists issues_created_at_idx on public.issues (created_at desc);

-- Labour and travel log: the actual-hours side of the pilot metrics.
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  staff_id uuid, -- null for people without a staff record
  kind text not null, -- survey | design | proposal | travel | install | rework | commissioning | handover | admin
  started_at timestamptz not null,
  ended_at timestamptz,
  minutes int check (minutes >= 0),

  entry jsonb not null default '{}' -- TimeEntry
);

create index if not exists time_entries_project_idx on public.time_entries (project_id, started_at);
create index if not exists time_entries_staff_idx on public.time_entries (staff_id, started_at);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

-- Invoices (deposit, balance, variation, fees, credit notes). `number` is the
-- sequential human reference ("DIH-0001") and must never repeat.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  number text not null unique,
  kind text not null,                   -- InvoiceKind
  status text not null default 'draft', -- draft | issued | part-paid | paid | void
  total_pence int not null default 0,
  paid_pence int not null default 0,

  invoice jsonb not null default '{}' -- Invoice
);

create index if not exists invoices_project_idx on public.invoices (project_id, created_at desc);
create index if not exists invoices_status_idx on public.invoices (status);

-- Verified payments only (honest states: nothing is "paid" without a row
-- here). `provider_ref` is the Stripe event/session id or a manual
-- reference, unique, so a replayed webhook can't record a payment twice.
-- No FK on invoice_id: a verified payment is kept even if its invoice can't
-- be matched, and reconciled by hand.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  invoice_id uuid,
  provider_ref text not null unique,
  provider text not null, -- stripe | manual | demo
  method text not null,   -- card | bank-transfer | cash | other
  amount_pence int not null,
  status text not null,   -- succeeded | pending | failed | refunded
  received_at timestamptz not null,

  payment jsonb not null default '{}' -- Payment
);

create index if not exists payments_project_idx on public.payments (project_id, received_at desc);
create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_status_idx on public.payments (status);

-- ---------------------------------------------------------------------------
-- Comms, records, learning
-- ---------------------------------------------------------------------------

-- The outbox (MessageRecord): every email and SMS, rendered body included,
-- whether sent, failed, skipped or demo. The idempotency key (event +
-- project + discriminator + channel) means a retried trigger never sends the
-- same message twice. `project_id` is null for messages with no project
-- (magic links, team alerts).
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  idempotency_key text not null unique,
  project_id uuid references public.projects (id) on delete cascade,
  event text not null,   -- CommsEventId
  channel text not null, -- email | sms
  to_address text not null,
  status text not null default 'queued', -- queued | sent | failed | demo | skipped
  provider_ref text,
  scheduled_for timestamptz,
  sent_at timestamptz,

  message jsonb not null default '{}' -- MessageRecord
);

create index if not exists messages_project_idx on public.messages (project_id, created_at desc);
create index if not exists messages_status_idx on public.messages (status);
create index if not exists messages_created_at_idx on public.messages (created_at desc);

-- The outbox cron's scan: queued messages that are due.
create index if not exists messages_due_idx
  on public.messages (scheduled_for)
  where status = 'queued';

-- Printable documents (DocumentRecord): proposal, contract, invoice,
-- certificates, handover pack. Each holds an immutable snapshot; a change is
-- a new version with a new `ref`.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null, -- DocumentKind
  version int not null default 1 check (version >= 1),
  ref text not null unique, -- e.g. DIH-PR-7F3A-v2
  status text not null default 'draft', -- draft | final | superseded
  customer_visible boolean not null default false,

  record jsonb not null default '{}' -- DocumentRecord
);

create index if not exists documents_project_idx on public.documents (project_id, kind, version desc);

-- Pilot learnings: answers to the learning prompts, and whether we acted.
create table if not exists public.learnings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'open', -- open | applied | wont-fix

  learning jsonb not null default '{}' -- Learning
);

create index if not exists learnings_project_idx on public.learnings (project_id, created_at desc);
create index if not exists learnings_status_idx on public.learnings (status);

-- ---------------------------------------------------------------------------
-- System
-- ---------------------------------------------------------------------------

-- Business settings (PilotSettings) as keyed JSON. Read through
-- mergeSettings(), so missing keys fall back to the domain defaults.
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Who did what. Append-only. Actor and entity ids are text because they
-- point at different tables (staff, customers, catalogue text keys,
-- settings keys) or at nothing (system).
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),

  actor_kind text not null, -- staff | customer | system
  actor_id text,
  actor_name text,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);

-- ---------------------------------------------------------------------------
-- Row level security: on, no policies. Only the service role reads/writes.
-- ---------------------------------------------------------------------------

alter table public.staff enable row level security;
alter table public.customers enable row level security;
alter table public.login_tokens enable row level security;
alter table public.media enable row level security;
alter table public.surveys enable row level security;
alter table public.designs enable row level security;
alter table public.proposals enable row level security;
alter table public.catalogue_items enable row level security;
alter table public.catalogue_compatibility enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.compliance_items enable row level security;
alter table public.install_jobs enable row level security;
alter table public.install_evidence enable row level security;
alter table public.issues enable row level security;
alter table public.time_entries enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.learnings enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;
-- No policies on purpose: the anon and authenticated keys get nothing.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private bucket for all staff and field media: survey and install photos,
-- signatures, certificates. Read via short-lived signed URLs only.
insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false)
on conflict (id) do nothing;
