-- Video walkthrough capture: the customer picks an archetype + install
-- permutation, records a narrated video walkthrough, and the pipeline
-- (transcribe → extract → draft survey → quote) turns it into a priced plan.
--
-- Pipeline states:
--   uploaded → transcribed → extracted → quoted
--   'needs_review' at any point when automation is unavailable or low-confidence.

create table public.video_surveys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- selection made before recording
  archetype_id text not null,
  permutation_id text not null,
  postcode text,

  -- media
  video_path text, -- object path in the survey-videos bucket
  duration_seconds integer,

  -- pipeline artefacts
  status text not null default 'uploaded',
  transcript text,
  extracted jsonb,        -- structured rooms/wishes from the narration
  draft_survey jsonb,     -- assembled Survey (engine input)
  quote jsonb,            -- engine output
  engine_version text,
  error text,

  -- link to a submitted quote request once contact details arrive
  quote_request_id uuid references public.quote_requests(id)
);

create index video_surveys_created_at_idx on public.video_surveys (created_at desc);
create index video_surveys_status_idx on public.video_surveys (status);

alter table public.video_surveys enable row level security;
-- Service role only, same as quote_requests.

insert into storage.buckets (id, name, public)
values ('survey-videos', 'survey-videos', false)
on conflict (id) do nothing;
