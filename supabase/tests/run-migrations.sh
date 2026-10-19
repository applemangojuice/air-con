#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres 16 cluster, then run the
# sanity checks. Nothing touches a real database: the cluster lives in a temp
# dir, listens only on a private unix socket, and is deleted on exit.
#
#   supabase/tests/run-migrations.sh            # from anywhere in the repo
#   PG_BIN=/opt/homebrew/opt/postgresql@16/bin supabase/tests/run-migrations.sh
#   KEEP=1 supabase/tests/run-migrations.sh     # keep the cluster dir for poking at
#
# Order of play:
#   1. initdb + start (as the `postgres` OS user when run as root: postgres
#      refuses to run as root)
#   2. supabase-stubs.sql: storage/auth schemas, API roles, default grants
#   3. supabase/migrations/*.sql in lexical order, each in one transaction
#   4. 0010 again on the fresh schema: proves it's re-runnable
#   5. sanity.sql: one row in every new table, constraints, the proposal guard
#   6. 0010 a third time, now over real rows: re-running never touches data
#
# Exits non-zero on the first SQL error (psql ON_ERROR_STOP).

set -euo pipefail
export LC_ALL=C # lexical migration order, whatever the caller's locale

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
PILOT_MIGRATION="$MIGRATIONS/0010_pilot_platform.sql"

if [[ -z "${PG_BIN:-}" ]]; then
  if [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then
    PG_BIN=/usr/lib/postgresql/16/bin
  elif command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    echo "run-migrations: no Postgres binaries found; set PG_BIN" >&2
    exit 2
  fi
fi

PG_OS_USER="${PG_OS_USER:-postgres}"
PORT="${PGTEST_PORT:-54329}" # only names the socket file; nothing listens on TCP
DB=aircon_test

# /tmp rather than $TMPDIR: when we run as root the postgres OS user must be
# able to reach the directory, and per-user temp dirs are often private.
WORK="$(mktemp -d "${PGTEST_TMP:-/tmp}/aircon-pgtest.XXXXXX")"
DATA="$WORK/data"
SOCK="$WORK/sock"
LOG="$WORK/postgres.log"
mkdir -p "$SOCK"

# Server-side commands run as the postgres OS user when we're root. psql is a
# client and stays as the caller, so it can read the repo wherever it lives.
as_pg() {
  if [[ "$(id -u)" == 0 ]]; then
    runuser -u "$PG_OS_USER" -- "$@"
  else
    "$@"
  fi
}
if [[ "$(id -u)" == 0 ]]; then
  chown -R "$PG_OS_USER" "$WORK"
fi

started=0
cleanup() {
  local status=$?
  if [[ $started == 1 ]]; then
    as_pg "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ $status != 0 && -f "$LOG" ]]; then
    echo "--- postgres log (last 40 lines) ---" >&2
    tail -n 40 "$LOG" >&2 || true
  fi
  if [[ "${KEEP:-0}" == 1 ]]; then
    echo "run-migrations: kept $WORK" >&2
  else
    rm -rf "$WORK"
  fi
  exit $status
}
trap cleanup EXIT

echo "==> initdb ($("$PG_BIN/postgres" --version))"
as_pg "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null

echo "==> start (socket in $SOCK)"
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -w \
  -o "-c listen_addresses='' -k '$SOCK' -p $PORT -c fsync=off" start >/dev/null
started=1

# Quiet by default: re-runs emit a NOTICE per "already exists, skipping".
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres)

"${PSQL[@]}" -d postgres -c "create database $DB"

apply() {
  echo "    $(basename "$1")"
  "${PSQL[@]}" -d "$DB" --single-transaction -f "$1"
}

echo "==> supabase stubs"
apply "$HERE/supabase-stubs.sql"

echo "==> migrations"
shopt -s nullglob
migrations=("$MIGRATIONS"/*.sql)
if [[ ${#migrations[@]} == 0 ]]; then
  echo "run-migrations: no migrations in $MIGRATIONS" >&2
  exit 1
fi
for f in "${migrations[@]}"; do
  apply "$f"
done

echo "==> re-apply 0010 (idempotency, empty schema)"
apply "$PILOT_MIGRATION"

echo "==> sanity checks"
# Query results go to /dev/null; \echo progress and the "ok: ..." notices still show.
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -d "$DB" -o /dev/null -f "$HERE/sanity.sql"

echo "==> re-apply 0010 (idempotency, populated schema)"
apply "$PILOT_MIGRATION"
"${PSQL[@]}" -d "$DB" -c "do \$\$ begin
  assert (select count(*) from public.proposals) > 0, 're-applying 0010 lost proposal rows';
  assert (select count(*) from public.install_evidence) > 0, 're-applying 0010 lost evidence rows';
  assert (select count(*) from storage.buckets where id = 'project-media') = 1, 'project-media bucket duplicated or missing';
  assert (select count(*) from storage.buckets where id in ('survey-photos', 'survey-videos', 'project-media')
          and file_size_limit > 0 and cardinality(allowed_mime_types) > 0) = 3, 'a bucket has no size or type limit (0011)';
  assert not (select 'text/html' = any(allowed_mime_types) from storage.buckets where id = 'survey-photos'), 'survey photos take HTML';
end \$\$;"

echo "==> all migration checks passed (${#migrations[@]} migrations)"
