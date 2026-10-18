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
   grants on `public`).
3. Applies every migration in lexical order, each in one transaction.
4. Applies `0010_pilot_platform.sql` again on the fresh schema.
5. Runs `sanity.sql`.
6. Applies `0010` a third time over the populated tables and checks no rows
   were lost.
7. Stops the cluster and deletes the directory.

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
- As `anon`, every table reads empty and writes are refused. As
  `service_role`, everything is visible, as on Supabase.

When you add a migration, add checks for it here. If it adds a unique
constraint, a default or a guard the app depends on, mirror it in
`apps/web/lib/db/local-schema.ts` too.
