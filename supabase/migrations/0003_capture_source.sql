-- Which instrument captured the survey (web funnel vs iOS capture app),
-- so conversion and survey quality can be compared per instrument.
alter table public.quote_requests
  add column source text not null default 'web';
