#!/usr/bin/env bash
# The app on a Supabase-shaped stack, end to end: the pilot walk, the quote
# funnel and every main screen over the DEMO pilots, with the app talking to
# Postgres only through PostgREST and the Storage API, exactly as it does on
# a real Supabase project (no DATA_BACKEND). Then everything is torn down.
#
#   bash supabase/tests/compat/run-compat-e2e.sh
#   SKIP_BUILD=1 bash supabase/tests/compat/run-compat-e2e.sh   # reuse apps/web/.next
#   ONLY=routes bash supabase/tests/compat/run-compat-e2e.sh    # pilot | funnel | intel | routes
#
# Needs: Postgres 16 server binaries, node, pnpm, a Chromium (CHROMIUM_PATH
# or /opt/pw-browsers), and a PostgREST 12.2.3 binary (POSTGREST_BIN, else
# downloaded once into ~/.cache/aircon-compat). Ports: COMPAT_APP_PORT
# (3390) plus the stack's (stack.sh). Exits non-zero if any walk fails or
# the app's log shows a database or storage error.
#
# The app runs as a demo deployment (ALLOW_DEMO_LOGIN=1 DEMO_DEPLOYMENT=1):
# the throwaway database holds nothing real, and the pilot walk needs what
# only a demo deployment does (the "Try as…" team, messages recorded as demo
# because no email provider is configured). That is the product's own
# switch, not a test-only one. The route walk signs in by break-glass
# (ADMIN_EMAILS + OPS_PASSWORD), the real way in.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
WEB="$ROOT/apps/web"
APP_PORT="${COMPAT_APP_PORT:-3390}"
ONLY="${ONLY:-pilot funnel intel routes}"

# shellcheck source=stack.sh
source "$HERE/stack.sh"

APP_PID=""
STATUS_FILE=""
teardown() {
  local status=$?
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  if [[ $status != 0 && -n "${COMPAT_WORK:-}" ]]; then
    for f in app.log gateway.log postgrest.log postgres.log; do
      [[ -f "$COMPAT_WORK/$f" ]] && { echo "--- $f (last 40 lines) ---" >&2; tail -n 40 "$COMPAT_WORK/$f" >&2; }
    done
    # The stack's dir goes; the logs and the walk's screenshots stay, to look at.
    local kept
    kept="$(mktemp -d "${PGTEST_TMP:-/tmp}/aircon-compat-failed.XXXXXX")"
    cp -r "$COMPAT_WORK"/*.log "$COMPAT_WORK"/*.txt "$COMPAT_WORK/shots" "$kept/" 2>/dev/null || true
    echo "compat: logs and screenshots kept in $kept" >&2
  fi
  compat_stop
  exit $status
}
trap teardown EXIT
trap 'exit 130' INT TERM

if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  echo "==> pnpm --filter @aircon/web build"
  (cd "$ROOT" && pnpm --filter @aircon/web build) >/dev/null
fi

compat_start

SESSION_SECRET="compat-session-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
OPS_PASSWORD="compat-break-glass-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
CRON_SECRET="compat-cron-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ADMIN_EMAIL="compat.admin@example.com"

echo "==> next start on :$APP_PORT (SUPABASE_URL=$SUPABASE_URL, no DATA_BACKEND)"
(
  cd "$WEB"
  unset DATA_BACKEND LOCAL_DATA_DIR
  exec env NODE_ENV=production SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    ALLOW_DEMO_LOGIN=1 DEMO_DEPLOYMENT=1 SESSION_SECRET="$SESSION_SECRET" \
    ADMIN_EMAILS="$ADMIN_EMAIL" OPS_PASSWORD="$OPS_PASSWORD" CRON_SECRET="$CRON_SECRET" \
    NEXT_PUBLIC_APP_URL="http://localhost:$APP_PORT" \
    node_modules/.bin/next start -p "$APP_PORT"
) >"$COMPAT_WORK/app.log" 2>&1 &
APP_PID=$!
compat_wait_http "http://localhost:$APP_PORT/api/health" app 300
health="$(curl -s "http://localhost:$APP_PORT/api/health")"
echo "    /api/health: $health"
[[ "$health" == *'"healthy":true'* ]] || { echo "compat: the app isn't healthy on the stack" >&2; exit 1; }

# The property book's importers (scripts/import-intel.mjs, recompute-intel.mjs)
# talk to Supabase directly: load 3,000 homes, three times the Max Rows a
# select returns, and check every one was enriched and classified.
compat_intel() {
  local dir="$COMPAT_WORK/intel"
  node "$WEB/scripts/make-sample-data.mjs" --count 300 --out "$dir" >/dev/null
  (
    cd "$WEB"
    node scripts/import-intel.mjs epc "$dir/epc-certificates.csv" --outcodes SW16,SW17
    node scripts/import-intel.mjs planning "$dir/planning.csv" --outcodes SW16,SW17
    node scripts/import-intel.mjs constraints "$dir/constraints.csv"
    node --experimental-strip-types scripts/recompute-intel.mjs
  ) 2>&1 | tr '\r' '\n' | grep -vE 'saved$|recomputed$|^$' | sed 's/^/    /'
  local counts
  counts="$("${COMPAT_PSQL[@]}" -At -c "select count(*) || ' ' || count(*) filter (where (intel->'constraints'->>'conservationArea')::boolean) || ' ' || count(*) filter (where archetype_id is not null) from public.properties")"
  echo "    homes / in a conservation area / classified: $counts (want 3000 900 3000)"
  [[ "$counts" == "3000 900 3000" ]]
}

failed=()
run_walk() {
  local name="$1"
  shift
  echo
  echo "==> $name"
  if ! "$@"; then failed+=("$name"); fi
}

export BASE_URL="http://localhost:$APP_PORT"
for walk in $ONLY; do
  case "$walk" in
    pilot) run_walk "pilot walk (e2e-pilot.mjs)" env SHOTS_DIR="$COMPAT_WORK/shots" node "$WEB/scripts/e2e-pilot.mjs" ;;
    funnel) run_walk "funnel walk (e2e-funnel.mjs)" node "$WEB/scripts/e2e-funnel.mjs" ;;
    intel) run_walk "property book import (3,000 homes, past Max Rows)" compat_intel && intel_rows=3000 ;;
    routes) run_walk "route walk (walk-routes.mjs)" env SHOTS_DIR="$COMPAT_WORK/shots" ADMIN_EMAIL="$ADMIN_EMAIL" OPS_PASSWORD="$OPS_PASSWORD" CRON_SECRET="$CRON_SECRET" EXPECT_INTEL_ROWS="${intel_rows:-}" node "$HERE/walk-routes.mjs" ;;
    *) echo "compat: unknown walk '$walk' (pilot, funnel, intel, routes)" >&2; exit 2 ;;
  esac
done

# What the pages swallowed: a statement Postgres refused, or a PostgREST or
# Storage error the app logged, is a failure even when the page rendered a
# fallback. A unique violation is the one error the app expects (a double tap
# or a retry meeting its guard: surveys.insertOrReuse, the 0013 guards), so
# those are listed, not failed.
echo
echo "==> postgres log"
grep -E "ERROR: " "$COMPAT_WORK/postgres.log" | sed -E 's/^.*(ERROR: )/\1/' | sort | uniq -c | sort -rn >"$COMPAT_WORK/pg-errors.txt" || true
if [[ -s "$COMPAT_WORK/pg-errors.txt" ]]; then
  cat "$COMPAT_WORK/pg-errors.txt"
  if grep -qv "duplicate key value violates unique constraint" "$COMPAT_WORK/pg-errors.txt"; then
    echo "compat: Postgres refused statements the app sent (above)" >&2
    failed+=("postgres log")
  fi
else
  echo "    no statement errors"
fi

echo
echo "==> app log"
if grep -nE '"code": ?"(PGRST|42|22|23|25|P0)[0-9A-Z]*"|code: '"'"'(PGRST|42|22|23|25|P0)[0-9A-Z]*'"'"'|StorageApiError|StorageUnknownError|column .* does not exist|Could not find the|violates|invalid input syntax' "$COMPAT_WORK/app.log" \
  | grep -vE 'already exists|duplicate key value violates unique constraint|23505' >"$COMPAT_WORK/app-errors.txt"; then
  echo "compat: database or storage errors in the app log:" >&2
  head -n 40 "$COMPAT_WORK/app-errors.txt" >&2
  failed+=("app log")
else
  echo "    no database or storage errors"
fi

echo
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "compat: FAILED: ${failed[*]}" >&2
  exit 1
fi
echo "==> compat run passed ($ONLY) on PostgREST 12.2.3 + Storage API + Postgres 16"
