-- Unique guards the app's check-then-insert relied on (hardening review,
-- batch 8). Each of these was a read followed by a write in app code, so two
-- people (or two tabs) pressing the button at the same moment both passed
-- the check. The database now refuses the second write, and the app answers
-- it in plain words.
--
-- Keep in step with apps/web/lib/db/local-schema.ts (the local backend's
-- uniques), which mirrors every index here by name. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Pilot numbers are unique (contract §K28)
-- ---------------------------------------------------------------------------

-- Two households sharing a number can't be fixed by a migration (which one
-- keeps it is a person's decision), so say which, and stop.
do $$
declare
  clash text;
begin
  select string_agg(format('pilot %s (%s)', pilot_number, names), '; ')
    into clash
    from (
      select pilot_number, string_agg(coalesce(nullif(customer_name, ''), id::text), ', ' order by created_at) as names
      from public.projects
      where pilot_number is not null
      group by pilot_number
      having count(*) > 1
    ) d;
  if clash is not null then
    raise exception 'Two households share a pilot number: %. Give one of them another number (the project''s Pilot box), then run this file again.', clash;
  end if;
end
$$;

create unique index if not exists projects_pilot_number_key
  on public.projects (pilot_number)
  where pilot_number is not null;

-- ---------------------------------------------------------------------------
-- Invoices: one per request, one at a time per project
-- ---------------------------------------------------------------------------

-- The form's one-off id (`requestId`): a double tap or a retry of the same
-- "Issue and email" can only ever make one invoice. A request that already
-- made two (the race this closes) keeps its first; the others lose only the
-- internal dedupe key, never a line or an amount, so the index can be built.
update public.invoices i
set invoice = i.invoice - 'requestId'
from (
  select id, row_number() over (partition by invoice->>'requestId' order by created_at, id) as n
  from public.invoices
  where invoice ? 'requestId'
) d
where d.id = i.id and d.n > 1;

create unique index if not exists invoices_request_id_key
  on public.invoices ((invoice->>'requestId'))
  where invoice ? 'requestId';

-- `issueKey`: the project's invoice count when the figure was worked out
-- (money-server issueInvoice), so every invoice is planned against the ones
-- before it. Two issued at the same moment (two deposits, two balances for
-- the whole balance, a balance and a credit note) were planned on the same
-- count: the second is refused and the office sees the first. A re-raised
-- deposit after a full credit note is still allowed: it's planned on a later
-- count. Invoices from before this file have no key and never clash.
create unique index if not exists invoices_issue_key
  on public.invoices (project_id, (invoice->>'issueKey'))
  where invoice ? 'issueKey';
