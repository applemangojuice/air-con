# Migration tests

Runs every migration in `supabase/migrations` against a throwaway local
Postgres 16 cluster, then checks that the result behaves as
`docs/pilot-architecture.md` §E says it should. Nothing here touches Supabase
or any real database.

```sh
supabase/tests/run-migrations.sh
```

You need Postgres 16 server binaries. The script uses
`/usr/lib/postgresql/16/bin` if it's there, otherwise whatever `initdb` is on
your `PATH`; set `PG_BIN` to point elsewhere. Running as root works: the
server runs as the `postgres` OS user (override with `PG_OS_USER`). Set
`KEEP=1` to keep the temp cluster directory for debugging.

It exits non-zero on the first SQL error or failed check, and prints the
tail of the server log when it does.

## What it does

1. Creates a cluster in a temp directory under `/tmp`, listening only on a
   private unix socket (no TCP).
2. Loads `supabase-stubs.sql`: the parts of a Supabase project our
   migrations assume (`storage.buckets`, the `auth` schema, `pgcrypto`, the
   `anon` / `authenticated` / `service_role` roles and Supabase's default
   grants on `public` as a project created today has them: none on tables.
   Supabase stopped granting new tables to its API roles by default in 2026
   (new projects since 30 May, existing ones for tables made from 30
   October), and a missing grant is "permission denied" even for the
   service role, so the migrations grant it themselves (`0014`).
3. Applies every migration in lexical order, each in one transaction;
   before `0014` the service role can't read a table, after it, it can.
4. Applies `0010_pilot_platform.sql` again on the fresh schema.
5. Compares the migrated schema with `apps/web/lib/db/db-schema.generated.ts`
   (`schema-dump.sql` | `schema-sync.mjs --check`): every column, type,
   NOT NULL, default, key, unique constraint, foreign key and check. The
   local data backend enforces that file, so it must be what the migrations
   make. After a migration, regenerate it with
   `UPDATE_SCHEMA=1 bash supabase/tests/run-migrations.sh` (and mirror any
   new partial/expression unique index or check constraint in
   `local-schema.ts`, which `tests/local-schema.test.ts` insists on).
6. Runs `sanity.sql`.
7. Applies `0010` a third time over the populated tables and checks no rows
   were lost, then `0013` over data from before it.
8. Runs `../check-schema.sql`, the read-only check the "Apply database
   upgrade" workflow runs against production, and checks
   `../pilot-upgrade.sql` is current with the migrations
   (`build-pilot-upgrade.sh --check`).
9. On a second database shaped like production before the pilot (stubs
   plus `0001` to `0009` only, made while tables were still granted by
   default, then Supabase's switch to granting nothing): `check-schema.sql`
   must fail and name what's missing; `pilot-upgrade.sql` runs twice;
   `check-schema.sql` and `sanity.sql` pass; with grants taken away again
   `check-schema.sql` names them and the bundle puts them back; one more run
   over real rows; then a run that stops part-way (two households on one
   pilot number) must change nothing at all.
10. Stops the cluster and deletes the directory.

## The one-paste upgrade

`supabase/pilot-upgrade.sql` is every migration from `0010` on, in one
transaction, for pasting into the Supabase SQL editor (or the
`.github/workflows/apply-migrations.yml` button). Don't edit it: change the
migration, then run `bash supabase/build-pilot-upgrade.sh`. A new migration
also needs a plain-words line in that script's `describe()`, and any new
table goes in `supabase/check-schema.sql` (`apps/web/tests/pilot-upgrade.test.ts`
checks both).

## What `sanity.sql` checks

- Every table in `public` has RLS on and there are no policies. All 22 §E
  tables exist. The `project-media` bucket exists and is private.
- The new `projects` columns, their defaults (`schema_version` 1, `blocked`
  false) and their links to `customers` and `staff`.
- One row in every new table, written with every contract column, plus the
  defaults the app relies on (messages queued, media annotations `[]`, staff
  flags).
- Every unique constraint fires `23505`: `projects.quote_id`, `staff.email`,
  `customers.email`, `login_tokens.token_hash`, designs and proposals
  `(project_id, version)`, `compliance_items (project_id, key)`,
  `install_jobs.project_id`, the `install_evidence` client id,
  `invoices.number`, `payments.provider_ref`, `messages.idempotency_key`,
  `documents.ref`, the `settings` and `catalogue_items` keys.
- An offline evidence retry (`on conflict (id) do nothing`) inserts nothing.
- Foreign keys and the few check constraints, and that deleting a customer
  unlinks their project rather than deleting it.
- The proposal guard. Before acceptance, edits are fine. Once accepted,
  options, the acceptance record, project, version and `accepted_at` are
  frozen, and the only allowed update is to `superseded`. An accepted proposal
  that has been superseded stays frozen. A proposal that was never accepted
  isn't guarded. Deleting a project still cascades.
- As `anon`, every table reads empty (or is refused outright) and writes are
  refused. As `service_role`, everything is visible, and every table in
  `public` takes its select, insert, update and delete, through the
  migrations' own grants.

When you add a migration, add checks for it here. If it adds a unique
constraint, a default or a guard the app depends on, mirror it in
`apps/web/lib/db/local-schema.ts` too.

# The app on a Supabase-shaped stack (`compat/`)

The app reaches its database only through supabase-js: PostgREST for tables
(`/rest/v1`) and the Storage API (`/storage/v1`), with the service-role key.
`compat/` runs it against those same APIs on this machine, so what would
break on a real Supabase project breaks here first:

```sh
bash supabase/tests/compat/run-compat-e2e.sh                 # build, stack, every walk, tear down
SKIP_BUILD=1 ONLY="pilot routes" bash supabase/tests/compat/run-compat-e2e.sh
bash supabase/tests/compat/stack.sh                          # just the stack, until Ctrl-C
```

The stack (`stack.sh`, everything in a temp dir, deleted on exit):

- **Postgres 16** as the `postgres` OS user (when run as root), UTF-8 with the
  C.UTF-8 locale, on a unix socket and `127.0.0.1:55432`
  (`COMPAT_PG_PORT`). The superuser is `supabase_admin`, which loads
  `supabase-stubs.sql` and `compat/compat-roles.sql`; every migration then
  runs as `postgres`, which, as on Supabase (and in its SQL editor), is not a
  superuser: CREATEROLE, CREATEDB, BYPASSRLS, owner of `public`, allowed to
  write `storage.buckets`, and with Supabase's 2026 defaults (no table is
  granted to the API roles unless a migration grants it). The roles are Supabase's: `anon`, `authenticated`,
  `service_role` (BYPASSRLS, so RLS-on-no-policies hides nothing from it) and
  an `authenticator` login role that PostgREST connects as and that can only
  switch to those three; Supabase's statement timeouts (8 s, anon 3 s).
- **PostgREST 12.2.3** on `127.0.0.1:3001` (`COMPAT_PGRST_PORT`), configured as
  Supabase configures it: schema `public`, anon role `anon`, `db-max-rows
  1000`, a fresh JWT secret. The binary is never committed: `POSTGREST_BIN`,
  else `~/.cache/aircon-compat`, else downloaded once from the GitHub release.
- **The gateway** (`compat/gateway.mjs`, node:http only) on
  `http://localhost:54321` (`COMPAT_GW_PORT`): the `SUPABASE_URL`. `/rest/v1`
  goes to PostgREST after Kong's key check (the `apikey` must be the project's
  anon or service-role key) and Supabase's pg-safeupdate rule (an UPDATE or
  DELETE with no filter is refused, 21000). `/storage/v1` is an
  implementation of the Storage API calls storage-js v2 makes (signed upload
  URLs and their PUT, signed read URLs one or many, upload, download, info,
  list, remove, move/copy, buckets), shaped like the real responses
  (`signedURL` relative to `/storage/v1`, `{ statusCode, error, message }`
  errors), with signed URLs as JWTs over `<bucket>/<path>`, Storage's key
  character rule, and each bucket's `file_size_limit` and
  `allowed_mime_types` read from `storage.buckets` (migration 0011).
- **Keys**: HS256 JWTs (`compat/jwt.mjs`, node:crypto) for `service_role`
  and `anon`, ten years, as a project issues them.

`run-compat-e2e.sh` then builds the app, starts `next start` on `:3390`
(`COMPAT_APP_PORT`) with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set
and **no** `DATA_BACKEND`, and runs:

| Walk | What |
| --- | --- |
| `pilot` | `apps/web/scripts/e2e-pilot.mjs`: one home from new pilot to closed, every role, on phones and a desk. |
| `funnel` | `apps/web/scripts/e2e-funnel.mjs`: the public quote funnel. |
| `intel` | The property-book importers (`import-intel.mjs`, `recompute-intel.mjs`) over 3,000 sample homes, three times Max Rows: every home enriched and classified. |
| `routes` | `compat/walk-routes.mjs`: break-glass sign-in (`ADMIN_EMAILS` + `OPS_PASSWORD`, the real way in), load the DEMO pilots, then every ops, field, portal and public screen reachable from the consoles (at most 2 pages per route pattern), ids that aren't there or aren't ids (404, never 5xx), a NUL in the funnel, the CSV exports (the property book's with all 3,000 homes) and every cron with `CRON_SECRET`. |

Afterwards it fails the run on any statement Postgres refused (the Postgres
log; unique violations are listed, since the app meets them on purpose: a
double tap, a retry), and on any PostgREST or Storage error the app logged,
because a page that swallowed one still rendered.

The app runs as a **demo deployment** (`ALLOW_DEMO_LOGIN=1
DEMO_DEPLOYMENT=1`): the database is a throwaway one holding nothing real,
which is exactly what that existing switch declares, and the pilot walk needs
it ("Try as…" for the whole team, and messages recorded as demo because no
email provider is configured: a live deployment without email refuses to
issue a proposal). No test-only escape hatch exists or is needed; the route
walk signs in by break-glass. The demo guard (`lib/auth/demo-guard.ts`) still
looks at the database on every check, as it would on a real project: the
walks only ever write reserved addresses (`@example.com`, the break-glass
admin `compat.admin@example.com`), which are nobody's data, so the demo stays
on; one real-looking address and demo sign-in would refuse itself here too.

Ports and paths are overridable (see the headers of `stack.sh` and
`run-compat-e2e.sh`); `KEEP=1` keeps the temp dir, `GATEWAY_LOG=1` logs every
gateway request to `$COMPAT_WORK/gateway.log`. A failed run keeps its logs
and the walks' screenshots (with the server HTML and hydrated DOM of any page
that failed to hydrate) in `/tmp/aircon-compat-failed.*` and says where.

## The local backend enforces the same schema

`apps/web/lib/db/local-client.ts` (the file and memory backends the unit
tests and the local e2e walk use) now refuses what Postgres and PostgREST
refuse, from `db-schema.generated.ts` plus `local-schema.ts`: unknown tables
(42P01) and columns (42703 / PGRST204); values cast to their column types the
way Postgres casts them (a non-uuid against a uuid column is 22P02 in a write
*and* in a filter, 1.5 into an integer is 22P02, NUL in text or jsonb is
22P05); NOT NULL (23502, including the proposed row of an upsert); check
constraints (23514); foreign keys, with ON DELETE cascade / set null / no
action (23503); ON CONFLICT only on a real unique constraint (42P10); unique
indexes checked in creation order, as Postgres reports them; and rows come
back as PostgREST returns them (timestamptz as `…+00:00`, dates as
`yyyy-mm-dd`, uuids lower case). Tests build rows with
`apps/web/tests/helpers/rows.ts`.
