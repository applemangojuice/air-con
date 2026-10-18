-- Sanity checks for the migrations, run by run-migrations.sh after every
-- migration has been applied to a throwaway cluster. Each check raises on
-- failure (psql runs with ON_ERROR_STOP), so a clean exit means all passed.
--
-- All data here is fictional DEMO data. The cluster is deleted afterwards,
-- so nothing is cleaned up.

\echo '--- sanity: helpers'

-- Run `stmt` and require it to fail with SQLSTATE `expected`
-- (23505 unique_violation, 23503 foreign_key_violation, 23514
-- check_violation, P0001 raise_exception). Succeeding is a failure.
create function pg_temp.expect_error(label text, expected text, stmt text)
returns void
language plpgsql
as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = expected then
      raise notice 'ok: % (rejected with %)', label, sqlstate;
      return;
    end if;
    raise exception 'FAIL %: expected SQLSTATE %, got %: %', label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %: expected SQLSTATE %, but the statement succeeded', label, expected;
end;
$$;

-- Run `stmt` and require it to succeed.
create function pg_temp.expect_ok(label text, stmt text)
returns void
language plpgsql
as $$
begin
  execute stmt;
  raise notice 'ok: %', label;
exception when others then
  raise exception 'FAIL %: expected success, got %: %', label, sqlstate, sqlerrm;
end;
$$;

\echo '--- sanity: schema shape'

-- Every table in public has RLS on and no policies: service role only.
do $$
declare
  open_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into open_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert open_tables is null, format('tables without RLS: %s', open_tables);

  assert (select count(*) from pg_policies where schemaname = 'public') = 0,
    'public tables should have no RLS policies';

  -- Every table from contract §E exists.
  assert (
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in (
      'staff', 'customers', 'login_tokens', 'media', 'surveys', 'designs', 'proposals',
      'catalogue_items', 'catalogue_compatibility', 'purchase_orders', 'compliance_items',
      'install_jobs', 'install_evidence', 'issues', 'time_entries', 'invoices', 'payments',
      'messages', 'documents', 'learnings', 'settings', 'audit_log')
  ) = 22, 'a §E table is missing';

  assert (select public = false from storage.buckets where id = 'project-media'),
    'project-media bucket missing or public';
  raise notice 'ok: RLS on every public table, 22 pilot tables, private project-media bucket';
end
$$;

\echo '--- sanity: people, quote, project'

insert into public.quote_requests (
  id, customer_name, email, postcode, address_line, engine_version,
  survey, quote, total_gbp, room_count, confidence_score, confidence_band
) values (
  'a0000000-0000-4000-8000-000000000001', 'DEMO Householder', 'demo.household@example.com',
  'SW16 1AA', '1 Demo Road', 'test', '{}', '{}', 6500, 2, 80, 'high'
);

insert into public.staff (id, email, name, phone, roles, external, active, qualifications, bio, photo_media_id, demo)
values (
  'c0000000-0000-4000-8000-000000000001', 'demo.techlead@example.com', 'DEMO Tech Lead', '07700 900001',
  array['tech-lead', 'installer'], false, true,
  '[{"kind": "fgas-cat1", "reference": "DEMO-FGAS-1"}]', 'Fictional demo engineer.', null, true
);

insert into public.customers (id, email, name, phone, ops_consent, marketing_consent)
values (
  'd0000000-0000-4000-8000-000000000001', 'demo.household@example.com', 'DEMO Householder',
  '07700 900002', '{"at": "2026-10-01T09:00:00.000Z", "source": "quote"}', null
);

insert into public.projects (id, quote_id, project, customer_name, postcode, current_stage)
values (
  'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  '{"schemaVersion": 2}', 'DEMO Householder', 'SW16 1AA', 'survey'
);

-- New project columns: defaults, and the links to customer and owner.
do $$
begin
  assert (select schema_version = 1 and blocked = false and value_pence is null
          from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
    'projects defaults: schema_version 1, blocked false';
  update public.projects
    set customer_id = 'd0000000-0000-4000-8000-000000000001',
        owner_staff_id = 'c0000000-0000-4000-8000-000000000001',
        schema_version = 2, pilot_number = 1, next_action = 'Book the home survey',
        next_action_at = '2026-11-02', value_pence = 850000, blocked = true
    where id = 'b0000000-0000-4000-8000-000000000001';
  assert (select count(*) from public.projects where next_action_at <= '2026-11-02' and blocked) = 1,
    'projects next-action scan';
  raise notice 'ok: projects v2 columns';
end
$$;

\echo '--- sanity: one row in every new table'

insert into public.login_tokens (token_hash, subject_kind, subject_id, email, purpose, next_path, expires_at, used_at)
values ('sha256-demo-token-1', 'staff', 'c0000000-0000-4000-8000-000000000001', 'demo.techlead@example.com',
        'login', '/ops', now() + interval '20 minutes', null);

insert into public.media (
  id, project_id, bucket, storage_path, content_type, tag, room_id, caption, source, taken_by,
  taken_at, customer_visible, width, height, annotations, annotations_version, locked
) values (
  'e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'project-media',
  'b0000000/survey/room-1.jpg', 'image/jpeg', 'room-overview', 'room-1', 'Front bedroom', 'survey',
  '{"kind": "staff", "name": "DEMO Tech Lead"}', now(), true, 1600, 1200,
  '[{"id": "a1", "type": "core-hole", "x": 0.4, "y": 0.2}]', 1, false
);

insert into public.surveys (project_id, version, status, data, surveyor, started_at, submitted_at, minutes)
values ('b0000000-0000-4000-8000-000000000001', 1, 'submitted', '{"version": 1}',
        '{"staffId": "c0000000-0000-4000-8000-000000000001", "name": "DEMO Tech Lead"}',
        now() - interval '90 minutes', now(), 90);

insert into public.designs (id, project_id, version, status, record)
values ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 'approved',
        '{"variants": []}');

insert into public.proposals (id, project_id, version, status, record, issued_at, accepted_at)
values ('f1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 'issued',
        '{"options": [{"id": "opt-a", "label": "Standard", "pricing": {"totalPence": 850000}}], "status": "issued"}',
        now(), null);

insert into public.catalogue_items (id, kind, manufacturer, series, model, label, tier, cost_pence, status, confidence, active, item)
values ('demo-indoor-25', 'indoor', 'DEMO', 'Demo Series', 'DM-25', 'DEMO 2.5 kW wall unit', 'standard', 45000,
        'available', 'provisional', true, '{"id": "demo-indoor-25"}');

insert into public.catalogue_compatibility (id, outdoor_model, rule)
values ('demo-rule-1', 'DM-OUT-50', '{"maxIndoorUnits": 2}');

insert into public.purchase_orders (project_id, supplier, status, po)
values ('b0000000-0000-4000-8000-000000000001', 'DEMO Supplies', 'ordered', '{"lines": []}');

insert into public.compliance_items (project_id, key, status, statutory, item)
values ('b0000000-0000-4000-8000-000000000001', 'planning-pd', 'approved', true, '{"key": "planning-pd"}');

insert into public.install_jobs (project_id, design_id, template_version, runsheet, step_statuses, exception_reviews, commissioning, qa)
values ('b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'test-1',
        '[]', '[]', '[]', null, '{"status": "in-progress"}');

insert into public.install_evidence (id, project_id, spec_id, value, ref, note, media_id, by_staff_id, by_name, at, gps)
values ('evidence-client-id-1', 'b0000000-0000-4000-8000-000000000001', 'vacuum-microns', 350.5, null, 'Held 15 min',
        'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'DEMO Tech Lead',
        now(), '{"lat": 51.42, "lng": -0.13}');

insert into public.issues (project_id, number, kind, status, severity, blocking, issue)
values ('b0000000-0000-4000-8000-000000000001', 1, 'snag', 'open', 'low', false, '{"title": "Trunking cap"}');

insert into public.time_entries (project_id, staff_id, kind, started_at, ended_at, minutes, entry)
values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'install',
        now() - interval '8 hours', now(), 480, '{"dayN": 1}');

insert into public.invoices (id, project_id, number, kind, status, total_pence, paid_pence, invoice)
values ('f2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'DIH-0001',
        'balance', 'issued', 850000, 0, '{"lines": []}');

insert into public.payments (project_id, invoice_id, provider_ref, provider, method, amount_pence, status, received_at, payment)
values ('b0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'demo_evt_1',
        'demo', 'card', 850000, 'succeeded', now(), '{}');

insert into public.messages (idempotency_key, project_id, event, channel, to_address, status, provider_ref, scheduled_for, sent_at, message)
values ('survey-booked:b0000000:slot-1:email', 'b0000000-0000-4000-8000-000000000001', 'survey-booked',
        'email', 'demo.household@example.com', 'demo', null, null, null, '{"bodyText": "DEMO"}');

-- A message with no project (magic links, team alerts).
insert into public.messages (idempotency_key, event, channel, to_address)
values ('magic-link:none:token-1:email', 'magic-link', 'email', 'demo.techlead@example.com');

insert into public.documents (project_id, kind, version, ref, status, customer_visible, record)
values ('b0000000-0000-4000-8000-000000000001', 'proposal', 1, 'DIH-PR-B000-v1', 'final', true, '{}');

insert into public.learnings (project_id, status, learning)
values ('b0000000-0000-4000-8000-000000000001', 'open', '{"answers": []}');

insert into public.settings (key, value, updated_by)
values ('pilot', '{"pricing": {"minMarginPct": 25}}', 'c0000000-0000-4000-8000-000000000001');

insert into public.audit_log (actor_kind, actor_id, actor_name, action, entity, entity_id, detail)
values ('staff', 'c0000000-0000-4000-8000-000000000001', 'DEMO Tech Lead', 'settings.save', 'settings', 'pilot', '{}');

-- Defaults the app leans on, via minimal inserts (media) and the
-- project-less message above.
insert into public.media (id, project_id, storage_path, content_type, source)
values ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
        'b0000000/ops/plan.png', 'image/png', 'ops');
do $$
begin
  assert (select status = 'queued' from public.messages
          where idempotency_key = 'magic-link:none:token-1:email'), 'messages status defaults to queued';
  assert (select bucket = 'project-media' and tag = 'other' and annotations = '[]'::jsonb
                 and annotations_version = 0 and customer_visible = false and locked = false
          from public.media where id = 'e0000000-0000-4000-8000-000000000002'),
    'media defaults';
  insert into public.staff (email, name) values ('demo.defaults@example.com', 'DEMO Defaults');
  assert (select roles = '{}' and external = false and active = true and demo = false
                 and qualifications = '[]'::jsonb
          from public.staff where email = 'demo.defaults@example.com'),
    'staff defaults';
  delete from public.staff where email = 'demo.defaults@example.com';
  raise notice 'ok: one row in every new table, defaults as documented';
end
$$;

\echo '--- sanity: unique constraints'

select pg_temp.expect_error('projects.quote_id unique', '23505', $sql$
  insert into public.projects (quote_id, project, customer_name, postcode, current_stage)
  values ('a0000000-0000-4000-8000-000000000001', '{}', 'DEMO', 'SW16 1AA', 'survey')
$sql$);

select pg_temp.expect_error('staff.email unique', '23505', $sql$
  insert into public.staff (email, name) values ('demo.techlead@example.com', 'DEMO Twin')
$sql$);

select pg_temp.expect_error('customers.email unique', '23505', $sql$
  insert into public.customers (email) values ('demo.household@example.com')
$sql$);

select pg_temp.expect_error('login_tokens.token_hash unique', '23505', $sql$
  insert into public.login_tokens (token_hash, subject_kind, email, expires_at)
  values ('sha256-demo-token-1', 'customer', 'x@example.com', now())
$sql$);

select pg_temp.expect_error('designs (project_id, version) unique', '23505', $sql$
  insert into public.designs (project_id, version) values ('b0000000-0000-4000-8000-000000000001', 1)
$sql$);

select pg_temp.expect_error('proposals (project_id, version) unique', '23505', $sql$
  insert into public.proposals (project_id, version) values ('b0000000-0000-4000-8000-000000000001', 1)
$sql$);

select pg_temp.expect_error('compliance_items (project_id, key) unique', '23505', $sql$
  insert into public.compliance_items (project_id, key) values ('b0000000-0000-4000-8000-000000000001', 'planning-pd')
$sql$);

select pg_temp.expect_error('install_jobs.project_id unique', '23505', $sql$
  insert into public.install_jobs (project_id) values ('b0000000-0000-4000-8000-000000000001')
$sql$);

select pg_temp.expect_error('install_evidence.id primary key', '23505', $sql$
  insert into public.install_evidence (id, project_id, spec_id, by_name, at)
  values ('evidence-client-id-1', 'b0000000-0000-4000-8000-000000000001', 'vacuum-microns', 'DEMO', now())
$sql$);

select pg_temp.expect_error('invoices.number unique', '23505', $sql$
  insert into public.invoices (project_id, number, kind) values ('b0000000-0000-4000-8000-000000000001', 'DIH-0001', 'deposit')
$sql$);

select pg_temp.expect_error('payments.provider_ref unique', '23505', $sql$
  insert into public.payments (project_id, provider_ref, provider, method, amount_pence, status, received_at)
  values ('b0000000-0000-4000-8000-000000000001', 'demo_evt_1', 'demo', 'card', 1, 'succeeded', now())
$sql$);

select pg_temp.expect_error('messages.idempotency_key unique', '23505', $sql$
  insert into public.messages (idempotency_key, event, channel, to_address)
  values ('survey-booked:b0000000:slot-1:email', 'survey-booked', 'email', 'x@example.com')
$sql$);

select pg_temp.expect_error('documents.ref unique', '23505', $sql$
  insert into public.documents (project_id, kind, ref) values ('b0000000-0000-4000-8000-000000000001', 'proposal', 'DIH-PR-B000-v1')
$sql$);

select pg_temp.expect_error('settings.key primary key', '23505', $sql$
  insert into public.settings (key, value) values ('pilot', '{}')
$sql$);

select pg_temp.expect_error('catalogue_items.id primary key', '23505', $sql$
  insert into public.catalogue_items (id, kind, label) values ('demo-indoor-25', 'indoor', 'dup')
$sql$);

-- The offline retry path: the same client id again is a no-op, not a duplicate.
do $$
declare
  n int;
begin
  insert into public.install_evidence (id, project_id, spec_id, by_name, at)
  values ('evidence-client-id-1', 'b0000000-0000-4000-8000-000000000001', 'vacuum-microns', 'DEMO', now())
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  assert n = 0, 'evidence retry should insert nothing';
  assert (select count(*) from public.install_evidence where id = 'evidence-client-id-1') = 1,
    'evidence retry duplicated a row';
  raise notice 'ok: install_evidence retry is idempotent';
end
$$;

\echo '--- sanity: foreign keys and checks'

select pg_temp.expect_error('child rows need a real project', '23503', $sql$
  insert into public.issues (project_id, number, kind)
  values ('b0000000-0000-4000-8000-00000000ffff', 1, 'snag')
$sql$);

select pg_temp.expect_error('projects.customer_id must exist', '23503', $sql$
  update public.projects set customer_id = 'd0000000-0000-4000-8000-00000000ffff'
  where id = 'b0000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('login_tokens.subject_kind is staff or customer', '23514', $sql$
  insert into public.login_tokens (token_hash, subject_kind, email, expires_at)
  values ('sha256-demo-token-2', 'robot', 'x@example.com', now())
$sql$);

select pg_temp.expect_error('proposals.status is a known value', '23514', $sql$
  insert into public.proposals (project_id, version, status)
  values ('b0000000-0000-4000-8000-000000000001', 9, 'Accepted')
$sql$);

select pg_temp.expect_error('versions start at 1', '23514', $sql$
  insert into public.designs (project_id, version) values ('b0000000-0000-4000-8000-000000000001', 0)
$sql$);

-- Removing a customer or staff member unlinks the project, never deletes it.
do $$
begin
  insert into public.customers (id, email) values ('d0000000-0000-4000-8000-000000000002', 'demo.erase@example.com');
  update public.projects set customer_id = 'd0000000-0000-4000-8000-000000000002'
    where id = 'b0000000-0000-4000-8000-000000000001';
  delete from public.customers where id = 'd0000000-0000-4000-8000-000000000002';
  assert (select customer_id is null from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
    'deleting a customer should null projects.customer_id';
  update public.projects set customer_id = 'd0000000-0000-4000-8000-000000000001'
    where id = 'b0000000-0000-4000-8000-000000000001';
  raise notice 'ok: customer delete sets projects.customer_id null';
end
$$;

\echo '--- sanity: accepted proposals are immutable'

-- Before acceptance the proposal is a working draft: edits are fine.
select pg_temp.expect_ok('issued proposal options can change', $sql$
  update public.proposals
    set record = jsonb_set(record, '{options,0,pricing,totalPence}', '860000')
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_ok('issued -> accepted', $sql$
  update public.proposals
    set status = 'accepted', accepted_at = '2026-10-10T12:00:00Z',
        record = record || '{"status": "accepted", "acceptance": {"optionId": "opt-a", "totalPence": 860000, "name": "DEMO Householder"}}'
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: options are frozen', 'P0001', $sql$
  update public.proposals
    set record = jsonb_set(record, '{options,0,pricing,totalPence}', '1')
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: acceptance record is frozen', 'P0001', $sql$
  update public.proposals
    set record = jsonb_set(record, '{acceptance,name}', '"Someone Else"')
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: other record fields are frozen too (status must go to superseded)', 'P0001', $sql$
  update public.proposals
    set record = record || '{"inclusions": ["changed"]}'
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: cannot be un-accepted', 'P0001', $sql$
  update public.proposals set status = 'issued' where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: even a no-op touch is refused', 'P0001', $sql$
  update public.proposals set updated_at = now() where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: superseding cannot smuggle an options change', 'P0001', $sql$
  update public.proposals
    set status = 'superseded', record = jsonb_set(record, '{options}', '[]')
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('accepted: superseding cannot renumber the version', 'P0001', $sql$
  update public.proposals set status = 'superseded', version = 7
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_ok('accepted -> superseded, options and acceptance unchanged', $sql$
  update public.proposals
    set status = 'superseded', updated_at = now(),
        record = record || '{"status": "superseded", "supersededBy": "f1000000-0000-4000-8000-000000000002"}'
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

do $$
begin
  assert (select status = 'superseded'
                 and record -> 'options' -> 0 -> 'pricing' ->> 'totalPence' = '860000'
                 and record -> 'acceptance' ->> 'name' = 'DEMO Householder'
          from public.proposals where id = 'f1000000-0000-4000-8000-000000000001'),
    'superseded proposal should keep the accepted options and acceptance';
  raise notice 'ok: superseded proposal keeps what was agreed';
end
$$;

-- Accepted then superseded is still the signed contract: no back door.
select pg_temp.expect_error('superseded (was accepted): options still frozen', 'P0001', $sql$
  update public.proposals
    set record = jsonb_set(record, '{options}', '[]')
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_error('superseded (was accepted): cannot return to accepted', 'P0001', $sql$
  update public.proposals set status = 'accepted' where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

select pg_temp.expect_ok('superseded (was accepted): bookkeeping can still change', $sql$
  update public.proposals
    set record = record || '{"supersededBy": "f1000000-0000-4000-8000-000000000003"}'
    where id = 'f1000000-0000-4000-8000-000000000001'
$sql$);

-- A proposal that was never accepted isn't guarded at all.
insert into public.proposals (id, project_id, version, status, record)
values ('f1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 2, 'superseded',
        '{"options": [{"id": "opt-b"}]}');
select pg_temp.expect_ok('never-accepted superseded proposal is editable', $sql$
  update public.proposals set status = 'draft', record = '{"options": []}'
    where id = 'f1000000-0000-4000-8000-000000000002'
$sql$);

-- Deletes aren't blocked: removing a project cascades through everything,
-- accepted proposals included.
do $$
begin
  insert into public.quote_requests (id, customer_name, email, postcode, address_line, engine_version,
                                     survey, quote, total_gbp, room_count, confidence_score, confidence_band)
  values ('a0000000-0000-4000-8000-000000000002', 'DEMO Two', 'demo.two@example.com', 'SW17 1AA',
          '2 Demo Road', 'test', '{}', '{}', 5000, 1, 70, 'medium');
  insert into public.projects (id, quote_id, project, customer_name, postcode, current_stage)
  values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '{}',
          'DEMO Two', 'SW17 1AA', 'proposal');
  insert into public.proposals (project_id, version, status, record, accepted_at)
  values ('b0000000-0000-4000-8000-000000000002', 1, 'accepted', '{"options": [], "acceptance": {}}', now());
  insert into public.install_evidence (id, project_id, spec_id, by_name, at)
  values ('evidence-client-id-2', 'b0000000-0000-4000-8000-000000000002', 'serial', 'DEMO', now());
  insert into public.messages (idempotency_key, project_id, event, channel, to_address)
  values ('proposal-issued:b0000000-2:v1:email', 'b0000000-0000-4000-8000-000000000002',
          'proposal-issued', 'email', 'demo.two@example.com');

  delete from public.projects where id = 'b0000000-0000-4000-8000-000000000002';

  assert (select count(*) from public.proposals where project_id = 'b0000000-0000-4000-8000-000000000002') = 0,
    'project delete should cascade to proposals';
  assert (select count(*) from public.install_evidence where project_id = 'b0000000-0000-4000-8000-000000000002') = 0,
    'project delete should cascade to evidence';
  assert (select count(*) from public.messages where project_id = 'b0000000-0000-4000-8000-000000000002') = 0,
    'project delete should cascade to messages';
  raise notice 'ok: project delete cascades, accepted proposal included';
end
$$;

\echo '--- sanity: API roles'

-- anon has table grants (Supabase defaults) but RLS with no policies hides
-- every row; service_role bypasses RLS, as on Supabase.
set role anon;
do $$
begin
  assert (select count(*) from public.staff) = 0, 'anon must not see staff';
  assert (select count(*) from public.proposals) = 0, 'anon must not see proposals';
  assert (select count(*) from public.payments) = 0, 'anon must not see payments';
end
$$;
select pg_temp.expect_error('anon cannot write', '42501', $sql$
  insert into public.audit_log (actor_kind, action, entity) values ('system', 'x', 'y')
$sql$);
reset role;

set role service_role;
do $$
begin
  assert (select count(*) from public.staff) = 1, 'service_role should see staff';
  assert (select count(*) from public.install_evidence) = 1, 'service_role should see evidence';
end
$$;
reset role;

do $$ begin raise notice 'ok: anon sees nothing, service_role sees everything'; end $$;

\echo '--- sanity: all checks passed'
