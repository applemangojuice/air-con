-- Save-early funnel: a quote_request row is created as soon as the customer
-- gives address + email (status 'draft'), then updated in place as they
-- progress and finalised on submit. Name arrives only at the end.

alter table public.quote_requests
  alter column customer_name drop not null;

-- status values now: draft | new | reviewed | booked | declined
