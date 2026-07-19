-- Ops CRM layer: the two primitives every field-service operation runs on
-- (per ServiceTitan/Jobber convention): an activity log on the lead, and a
-- next-action date that powers the "what do I chase today?" worklist.

create table if not exists public.ops_notes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quote_requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  author text not null default 'ops',
  note text not null
);

create index if not exists ops_notes_quote_idx on public.ops_notes (quote_id, created_at desc);

alter table public.ops_notes enable row level security;
-- No policies on purpose: service role (ops pages) only.

-- The follow-up loop: what's the next move on this lead, and when is it due?
alter table public.quote_requests
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz;

-- The "due today" scan: only rows with an action set are in the index.
create index if not exists quote_requests_next_action_idx
  on public.quote_requests (next_action_at)
  where next_action_at is not null;
