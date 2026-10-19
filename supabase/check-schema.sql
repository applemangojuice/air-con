-- Is everything the app needs in this database? A read-only check: it runs
-- in a read-only transaction, so it can't change anything, ever.
--
-- To run it: supabase.com → your project → SQL Editor → New query → paste
-- this whole file → Run.
--   * One row saying "All present": the database is ready.
--   * An error starting "Missing": it names each missing piece. Run
--     supabase/pilot-upgrade.sql (or the "Apply database upgrade" GitHub
--     workflow), then run this again.
--
-- What it checks: every table the migrations create (0001 to 0014), that
-- each one is locked to the server (row level security on) and that the
-- server can use it (the service role's select, insert, update and delete:
-- Supabase stopped giving those to new tables by default in 2026, 0014 gives
-- them), the columns the pilot adds to older tables, the three photo and
-- video stores with their size and file-type limits, the shared sign-in
-- counter, the guard that freezes an accepted proposal, and the duplicate
-- guards.
--
-- The "Apply database upgrade" workflow runs it after every upgrade, and
-- supabase/tests/run-migrations.sh proves it passes on a fully migrated
-- database and fails on one without the pilot upgrade. A new migration that
-- adds a table adds it here too (apps/web/tests/pilot-upgrade.test.ts
-- checks that every table the migrations create is listed).

begin transaction read only;

do $$
declare
  missing text[] := '{}';
  t text;
  p text;
  lacking text[];
  c text;
  b text;
  i text;
  -- Every table, by the migration that creates it.
  tables text[] := array[
    -- 0001 to 0009: the original site
    'quote_requests', 'video_surveys', 'projects', 'properties', 'property_assessments',
    'analytics_events', 'ops_notes',
    -- 0010: the pilot platform
    'staff', 'login_tokens', 'customers', 'media', 'surveys', 'designs', 'proposals',
    'catalogue_items', 'catalogue_compatibility', 'purchase_orders', 'compliance_items',
    'install_jobs', 'install_evidence', 'issues', 'time_entries', 'invoices', 'payments',
    'messages', 'documents', 'learnings', 'settings', 'audit_log',
    -- 0012: shared sign-in limits
    'rate_limits'
  ];
  -- Columns 0010 adds to tables an earlier file made (apps/web/lib/schema-check.ts PILOT_COLUMNS).
  columns text[] := array[
    'projects.schema_version', 'projects.customer_id', 'projects.pilot_number', 'projects.owner_staff_id',
    'projects.next_action', 'projects.next_action_at', 'projects.value_pence', 'projects.blocked',
    'media.annotations_version', 'media.locked'
  ];
  buckets text[] := array['survey-photos', 'survey-videos', 'project-media'];
  -- 0013: one pilot number per household, one invoice per click.
  indexes text[] := array['projects_pilot_number_key', 'invoices_request_id_key', 'invoices_issue_key'];
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    missing := missing || 'the service_role role (is this a Supabase database?)'::text;
  elsif not has_schema_privilege('service_role', 'public', 'usage') then
    missing := missing || 'the server''s use of the public schema (0014)'::text;
  end if;

  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      missing := missing || format('table %s', t);
    elsif not (select relrowsecurity from pg_class where oid = to_regclass(format('public.%I', t))) then
      missing := missing || format('row level security on %s (anyone with the public key could read it)', t);
    elsif exists (select 1 from pg_roles where rolname = 'service_role') then
      -- One privilege at a time: has_table_privilege with a list is true if any one is held.
      lacking := '{}';
      foreach p in array array['select', 'insert', 'update', 'delete'] loop
        if not has_table_privilege('service_role', format('public.%I', t), p) then
          lacking := lacking || p;
        end if;
      end loop;
      if cardinality(lacking) > 0 then
        missing := missing || format('the server''s use of table %s (%s, from 0014; without it the app gets "permission denied")', t, array_to_string(lacking, ', '));
      end if;
    end if;
  end loop;

  foreach c in array columns loop
    if to_regclass(format('public.%I', split_part(c, '.', 1))) is not null and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = split_part(c, '.', 1) and column_name = split_part(c, '.', 2)
    ) then
      missing := missing || format('column %s', c);
    end if;
  end loop;

  if to_regclass('storage.buckets') is null then
    missing := missing || 'the storage schema (is this a Supabase database?)'::text;
  else
    foreach b in array buckets loop
      if not exists (select 1 from storage.buckets where id = b) then
        missing := missing || format('photo store %s', b);
      elsif exists (select 1 from storage.buckets where id = b and public) then
        missing := missing || format('photo store %s is public: it must be private', b);
      elsif not exists (
        select 1 from storage.buckets
        where id = b and coalesce(file_size_limit, 0) > 0 and coalesce(cardinality(allowed_mime_types), 0) > 0
      ) then
        missing := missing || format('size and file-type limits on %s (0011)', b);
      end if;
    end loop;
  end if;

  if to_regprocedure('public.rate_limit_hit(text, integer, integer)') is null then
    missing := missing || 'the shared sign-in counter rate_limit_hit (0012)'::text;
  end if;

  if to_regclass('public.proposals') is not null and not exists (
    select 1 from pg_trigger where tgname = 'proposals_guard_accepted' and tgrelid = to_regclass('public.proposals')
  ) then
    missing := missing || 'the accepted-proposal guard (0010)'::text;
  end if;

  foreach i in array indexes loop
    if to_regclass(format('public.%I', i)) is null then
      missing := missing || format('duplicate guard %s (0013)', i);
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'Missing % of what the app needs: %.', cardinality(missing), array_to_string(missing, '; ')
      using hint = 'Run supabase/pilot-upgrade.sql in the Supabase SQL Editor (or the "Apply database upgrade" GitHub workflow), then run this check again.';
  end if;
  raise notice 'All present: % tables (each usable by the server), % columns, % photo stores, the sign-in counter, the proposal guard and % duplicate guards.',
    cardinality(tables), cardinality(columns), cardinality(buckets), cardinality(indexes);
end
$$;

select 'All present: every table (each usable by the server), column, photo store and safety check the app needs is in this database.' as result;

commit;
