-- Booking requests land on the quote they belong to. A quote "becomes" a job
-- later (jobs table arrives with scheduling); until then the booking snapshot
-- lives here.

alter table public.quote_requests
  add column booking jsonb,
  add column booked_at timestamptz;

-- status values now: new | reviewed | booked | declined
