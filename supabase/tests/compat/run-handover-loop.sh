#!/usr/bin/env bash
# The handover screen, many times over, on a slowed-down Supabase-shaped
# stack: the pilot walk up to commissioning (E2E_UNTIL=I), then
# e2e-handover-loop.mjs publishes the pack and has the family sign, LOOPS
# times, putting the job back between rounds. The walk runs at full speed;
# for the rounds the gateway holds every REST and Storage request
# GATEWAY_LATENCY_MS plus up to GATEWAY_JITTER_MS (test only), so the
# screen's requests overlap and land out of order the way they do between
# Vercel and a busy Supabase project.
#
#   bash supabase/tests/compat/run-handover-loop.sh
#   SKIP_BUILD=1 LOOPS=30 GATEWAY_LATENCY_MS=60 GATEWAY_JITTER_MS=240 bash supabase/tests/compat/run-handover-loop.sh
#
# Needs what run-compat-e2e.sh needs. Ports: COMPAT_APP_PORT (3390) plus
# the stack's (stack.sh). Exits non-zero if the walk or any round fails.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
WEB="$ROOT/apps/web"
APP_PORT="${COMPAT_APP_PORT:-3390}"
LATENCY="${GATEWAY_LATENCY_MS:-40}"
JITTER="${GATEWAY_JITTER_MS:-160}"
unset GATEWAY_LATENCY_MS GATEWAY_JITTER_MS

# shellcheck source=stack.sh
source "$HERE/stack.sh"

APP_PID=""
teardown() {
  local status=$?
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  if [[ $status != 0 && -n "${COMPAT_WORK:-}" ]]; then
    local kept
    kept="$(mktemp -d "${PGTEST_TMP:-/tmp}/aircon-handover-failed.XXXXXX")"
    cp -r "$COMPAT_WORK"/*.log "$COMPAT_WORK/shots" "$kept/" 2>/dev/null || true
    echo "handover loop: logs and screenshots kept in $kept" >&2
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
echo "==> next start on :$APP_PORT (SUPABASE_URL=$SUPABASE_URL, no DATA_BACKEND)"
(
  cd "$WEB"
  unset DATA_BACKEND LOCAL_DATA_DIR
  exec env NODE_ENV=production SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    ALLOW_DEMO_LOGIN=1 DEMO_DEPLOYMENT=1 SESSION_SECRET="$SESSION_SECRET" \
    NEXT_PUBLIC_APP_URL="http://localhost:$APP_PORT" \
    node_modules/.bin/next start -p "$APP_PORT"
) >"$COMPAT_WORK/app.log" 2>&1 &
APP_PID=$!
compat_wait_http "http://localhost:$APP_PORT/api/health" app 300

export BASE_URL="http://localhost:$APP_PORT"
mkdir -p "$COMPAT_WORK/shots"
echo
echo "==> pilot walk to commissioning (E2E_UNTIL=I)"
if ! E2E_UNTIL=I E2E_IDS_FILE="$COMPAT_WORK/ids.json" SHOTS_DIR="$COMPAT_WORK/shots" node "$WEB/scripts/e2e-pilot.mjs" >"$COMPAT_WORK/walk.log" 2>&1; then
  tail -n 60 "$COMPAT_WORK/walk.log" >&2
  exit 1
fi
tail -n 1 "$COMPAT_WORK/walk.log"
echo
curl -fsS -X POST "$SUPABASE_URL/__compat/latency?ms=$LATENCY&jitter=$JITTER" >/dev/null
echo "==> handover, ${LOOPS:-30} times (gateway test latency: $LATENCY ms + up to $JITTER ms per request)"
IDS_FILE="$COMPAT_WORK/ids.json" SHOTS_DIR="$COMPAT_WORK/shots" node "$WEB/scripts/e2e-handover-loop.mjs"
