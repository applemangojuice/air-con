-- Automated draft follow-up: one friendly email to people who started the
-- funnel (gave address + email) but never finished. Sent once, ever, per
-- enquiry — the timestamp doubles as the "already contacted" flag.

alter table public.quote_requests
  add column if not exists follow_up_sent_at timestamptz;

-- The cron scans for: status='draft' and follow_up_sent_at is null,
-- bounded by created_at. Partial index keeps that scan free.
create index if not exists quote_requests_follow_up_idx
  on public.quote_requests (created_at)
  where status = 'draft' and follow_up_sent_at is null;
