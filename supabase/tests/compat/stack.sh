#!/usr/bin/env bash
# A Supabase-shaped stack on this machine, for running the app against the
# same APIs a real Supabase project serves: Postgres 16 with Supabase's
# roles, every migration, PostgREST 12.2.3 and a gateway that does Kong's
# key check and the Storage API (gateway.mjs). Test harness only: everything
# lives in a temp dir, listens on localhost and is deleted on stop.
#
#   bash supabase/tests/compat/stack.sh        # start it, print the env, wait for Ctrl-C
#   source supabase/tests/compat/stack.sh      # or use compat_start / compat_stop
#
# Env (all optional):
#   PG_BIN           Postgres 16 binaries (default /usr/lib/postgresql/16/bin, else PATH)
#   PG_OS_USER       OS user the server runs as when we're root (default postgres)
#   COMPAT_PG_PORT   Postgres TCP port (default 55432)
#   COMPAT_PGRST_PORT PostgREST port (default 3001)
#   COMPAT_GW_PORT   gateway port: the SUPABASE_URL (default 54321)
#   POSTGREST_BIN    a PostgREST 12.2.3 binary; else ~/.cache/aircon-compat, else downloaded
#   GATEWAY_LOG=1    log every gateway request (to $COMPAT_WORK/gateway.log)
#   GATEWAY_LATENCY_MS, GATEWAY_JITTER_MS  test-only: hold every REST and Storage request
#                    that long plus a random 0 to JITTER more (gateway.mjs; off by default)
#   KEEP=1           keep the temp dir on stop
#
# After compat_start: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
# COMPAT_WORK and COMPAT_PSQL (an array: psql as the superuser, supabase_admin, on the stack's
# database) are set.

set -euo pipefail
export LC_ALL=C

COMPAT_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPAT_ROOT="$(cd "$COMPAT_HERE/../../.." && pwd)"
POSTGREST_VERSION=v12.2.3

compat_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then
    echo "$PG_BIN"
  elif [[ -x /usr/lib/postgresql/16/bin/initdb ]]; then
    echo /usr/lib/postgresql/16/bin
  elif command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
  else
    echo "compat: no Postgres binaries found; set PG_BIN" >&2
    return 2
  fi
}

# The PostgREST binary: POSTGREST_BIN, the cache, or GitHub's release (never committed).
compat_postgrest_bin() {
  if [[ -n "${POSTGREST_BIN:-}" ]]; then
    [[ -x "$POSTGREST_BIN" ]] || { echo "compat: POSTGREST_BIN=$POSTGREST_BIN is not executable" >&2; return 2; }
    echo "$POSTGREST_BIN"
    return
  fi
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/aircon-compat/postgrest-$POSTGREST_VERSION"
  if [[ ! -x "$cache/postgrest" ]]; then
    local arch
    case "$(uname -m)" in
      x86_64) arch=linux-static-x64 ;;
      aarch64 | arm64) arch=ubuntu-aarch64 ;;
      *) echo "compat: no PostgREST release for $(uname -m); set POSTGREST_BIN" >&2; return 2 ;;
    esac
    local url="https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-$arch.tar.xz"
    echo "compat: downloading $url" >&2
    mkdir -p "$cache"
    local dl
    dl="$(mktemp -d)"
    curl -fsSL "$url" -o "$dl/postgrest.tar.xz"
    tar -xJf "$dl/postgrest.tar.xz" -C "$dl"
    install -m 0755 "$dl/postgrest" "$cache/postgrest"
    rm -rf "$dl"
  fi
  echo "$cache/postgrest"
}

compat_as_pg() {
  if [[ "$(id -u)" == 0 ]]; then
    runuser -u "${PG_OS_USER:-postgres}" -- "$@"
  else
    "$@"
  fi
}

compat_wait_http() {
  local url="$1" name="$2" tries="${3:-100}"
  for ((i = 0; i < tries; i++)); do
    if curl -fs -o /dev/null "$url" 2>/dev/null; then return 0; fi
    # Any HTTP answer means it's up (PostgREST answers / with 200, the gateway with 404).
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" != 000 ]]; then return 0; fi
    sleep 0.2
  done
  echo "compat: $name didn't come up at $url" >&2
  return 1
}

compat_start() {
  local pg_bin pgrst_src
  pg_bin="$(compat_pg_bin)"
  pgrst_src="$(compat_postgrest_bin)"
  local pg_port="${COMPAT_PG_PORT:-55432}" pgrst_port="${COMPAT_PGRST_PORT:-3001}" gw_port="${COMPAT_GW_PORT:-54321}"

  # /tmp, so the postgres OS user can reach it when we're root.
  COMPAT_WORK="$(mktemp -d "${PGTEST_TMP:-/tmp}/aircon-compat.XXXXXX")"
  export COMPAT_WORK
  local data="$COMPAT_WORK/data" sock="$COMPAT_WORK/sock"
  mkdir -p "$sock" "$COMPAT_WORK/storage"
  [[ "$(id -u)" == 0 ]] && chown -R "${PG_OS_USER:-postgres}" "$COMPAT_WORK"
  echo "==> compat stack in $COMPAT_WORK"

  echo "==> postgres ($("$pg_bin/postgres" --version)) on 127.0.0.1:$pg_port"
  # Supabase databases are UTF-8 with the C.UTF-8 locale (byte-order collation); plain C where it's missing.
  local locale=(--no-locale)
  if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then locale=(--locale=C.UTF-8); fi
  # The superuser is supabase_admin, as on Supabase; `postgres` (who runs the migrations) isn't one.
  compat_as_pg "$pg_bin/initdb" -D "$data" -U supabase_admin --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 "${locale[@]}" >/dev/null
  compat_as_pg "$pg_bin/pg_ctl" -D "$data" -l "$COMPAT_WORK/postgres.log" -w \
    -o "-c listen_addresses=127.0.0.1 -p $pg_port -k '$sock' -c fsync=off -c timezone=UTC" start >/dev/null
  echo "$pg_bin" >"$COMPAT_WORK/pg_bin"

  export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
  COMPAT_PSQL=("$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -p "$pg_port" -U supabase_admin -d postgres)
  local migrate=("$pg_bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -p "$pg_port" -U postgres -d postgres)
  local f
  for f in "$COMPAT_ROOT/supabase/tests/supabase-stubs.sql" "$COMPAT_HERE/compat-roles.sql"; do
    echo "    $(basename "$f") (as supabase_admin)"
    "${COMPAT_PSQL[@]}" --single-transaction -f "$f"
  done
  shopt -s nullglob
  for f in "$COMPAT_ROOT"/supabase/migrations/*.sql; do
    echo "    $(basename "$f") (as postgres, not a superuser)"
    "${migrate[@]}" --single-transaction -f "$f"
  done

  # Keys: HS256 JWTs over a fresh secret, as a Supabase project's are.
  local secret
  secret="compat-jwt-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  SUPABASE_SERVICE_ROLE_KEY="$(node "$COMPAT_HERE/jwt.mjs" "$secret" service_role)"
  SUPABASE_ANON_KEY="$(node "$COMPAT_HERE/jwt.mjs" "$secret" anon)"
  SUPABASE_URL="http://localhost:$gw_port"
  export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY

  echo "==> postgrest $POSTGREST_VERSION on 127.0.0.1:$pgrst_port"
  cp "$pgrst_src" "$COMPAT_WORK/postgrest"
  chmod 0755 "$COMPAT_WORK/postgrest"
  cat >"$COMPAT_WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:compat-authenticator@127.0.0.1:$pg_port/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
db-max-rows = 1000
db-pool = 10
db-plan-enabled = false
jwt-secret = "$secret"
server-host = "127.0.0.1"
server-port = $pgrst_port
log-level = "warn"
CONF
  "$COMPAT_WORK/postgrest" "$COMPAT_WORK/postgrest.conf" >"$COMPAT_WORK/postgrest.log" 2>&1 &
  echo $! >"$COMPAT_WORK/postgrest.pid"
  compat_wait_http "http://127.0.0.1:$pgrst_port/" postgrest

  echo "==> gateway on $SUPABASE_URL"
  GATEWAY_PORT="$gw_port" POSTGREST_URL="http://127.0.0.1:$pgrst_port" JWT_SECRET="$secret" \
    ANON_KEY="$SUPABASE_ANON_KEY" SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    STORAGE_DIR="$COMPAT_WORK/storage" PSQL="$pg_bin/psql" PGHOST="$sock" PGPORT="$pg_port" \
    PGUSER=supabase_admin PGDATABASE=postgres node "$COMPAT_HERE/gateway.mjs" >"$COMPAT_WORK/gateway.log" 2>&1 &
  echo $! >"$COMPAT_WORK/gateway.pid"
  compat_wait_http "http://127.0.0.1:$gw_port/health" gateway

  cat >"$COMPAT_WORK/env.sh" <<ENV
export SUPABASE_URL='$SUPABASE_URL'
export SUPABASE_SERVICE_ROLE_KEY='$SUPABASE_SERVICE_ROLE_KEY'
export SUPABASE_ANON_KEY='$SUPABASE_ANON_KEY'
ENV
}

compat_stop() {
  [[ -n "${COMPAT_WORK:-}" && -d "$COMPAT_WORK" ]] || return 0
  local pid
  for f in gateway postgrest; do
    if [[ -f "$COMPAT_WORK/$f.pid" ]]; then
      pid="$(cat "$COMPAT_WORK/$f.pid")"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  if [[ -f "$COMPAT_WORK/pg_bin" ]]; then
    compat_as_pg "$(cat "$COMPAT_WORK/pg_bin")/pg_ctl" -D "$COMPAT_WORK/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ "${KEEP:-0}" == 1 ]]; then
    echo "compat: kept $COMPAT_WORK" >&2
  else
    rm -rf "$COMPAT_WORK"
  fi
  COMPAT_WORK=""
}

# Run directly: start, show how to point the app at it, wait.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap 'compat_stop; kill $(jobs -p) 2>/dev/null || true' EXIT
  trap 'exit 130' INT TERM
  compat_start
  echo
  echo "Stack up. Point the app at it with:"
  echo "  source $COMPAT_WORK/env.sh"
  echo "psql: ${COMPAT_PSQL[*]}"
  echo "Ctrl-C stops it and deletes $COMPAT_WORK."
  # `wait` (not a foreground sleep) so a signal runs the trap at once.
  while true; do
    sleep 3600 &
    wait $! || true
  done
fi
