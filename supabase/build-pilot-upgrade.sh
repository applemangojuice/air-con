#!/usr/bin/env bash
# Builds supabase/pilot-upgrade.sql: every migration from 0010 on, in order,
# in one file the founder pastes into the Supabase SQL editor once (or runs
# with the "Apply database upgrade" GitHub workflow).
#
#   bash supabase/build-pilot-upgrade.sh          # rewrite pilot-upgrade.sql
#   bash supabase/build-pilot-upgrade.sh --check  # exit 1 if it's out of date
#
# supabase/tests/run-migrations.sh runs --check, so a new migration that
# isn't in the bundle fails the tests. A new migration also needs a line in
# describe() below: that's the bundle's plain-words "what it does".

set -euo pipefail
export LC_ALL=C # lexical migration order, whatever the caller's locale

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/migrations"
OUT="$HERE/pilot-upgrade.sql"
FIRST=0010 # the pilot platform; 0001 to 0009 are the original site

describe() {
  case "$1" in
    0010_pilot_platform.sql)
      echo "The pilot platform. Adds the team and sign-in tables, customers,"
      echo "--         surveys, designs, proposals, kit orders, install records, issues,"
      echo "--         time, invoices, payments, messages, documents, settings and the"
      echo "--         audit log, a few columns on projects for the board, and the"
      echo "--         private project-media photo store. Without it nobody can sign in." ;;
    0011_storage_limits.sql)
      echo "Sets a size limit and the allowed file types on each photo and"
      echo "--         video store (the public quote form takes photos only)." ;;
    0012_rate_limits.sql)
      echo "Counts sign-in attempts once for the whole site, so the limits on"
      echo "--         sign-in emails and the break-glass password can't be dodged." ;;
    0013_unique_guards.sql)
      echo "Stops two households sharing a pilot number, and stops a double"
      echo "--         click making two invoices." ;;
    *) return 1 ;;
  esac
}

shopt -s nullglob
files=()
for f in "$MIGRATIONS"/*.sql; do
  name="$(basename "$f")"
  [[ "${name:0:4}" < "$FIRST" ]] && continue
  files+=("$f")
done
if [[ ${#files[@]} == 0 ]]; then
  echo "build-pilot-upgrade: no migrations from $FIRST in $MIGRATIONS" >&2
  exit 1
fi
first_name="$(basename "${files[0]}")"
last_name="$(basename "${files[${#files[@]}-1]}")"

build() {
  cat <<EOF
-- =============================================================================
-- Dang, It's Hot: pilot upgrade (migrations ${first_name:0:4} to ${last_name:0:4}, in one file)
-- =============================================================================
--
-- Built by supabase/build-pilot-upgrade.sh from supabase/migrations. Don't
-- edit it by hand: change the migration, then run that script.
--
-- WHAT IT IS FOR
--   A Supabase database that already has the original site (migrations
--   0001 to 0009: quotes, bookings, projects, property data, analytics).
--   This adds everything the pilot platform needs on top, in order.
--   A brand-new, empty database: run 0001 to 0009 from supabase/migrations
--   first (in order, both 0006 files), then this file.
--
-- WHAT IT DOES
EOF
  for f in "${files[@]}"; do
    name="$(basename "$f")"
    if ! text="$(describe "$name")"; then
      echo "build-pilot-upgrade: add a describe() line for $name" >&2
      return 1
    fi
    echo "--   ${name:0:4}  $text"
  done
  cat <<'EOF'
--
-- SAFE TO RE-RUN
--   Yes. Every step only adds what's missing ("create ... if not exists"),
--   so running it a second time changes nothing. It never deletes a table,
--   a customer, a project, a quote, a photo or a payment. The only existing
--   rows it touches: the storage limits (set to the same values each time)
--   and, if one click ever made two invoices, the second invoice's internal
--   duplicate-check key (never a line or an amount).
--   It all runs as one transaction: if anything stops it, nothing at all is
--   changed, and you can fix the problem and run it again.
--
-- HOW TO RUN IT
--   1. supabase.com → your project → SQL Editor (left menu) → New query.
--   2. Paste this whole file in, then click Run.
--   3. If Supabase warns about a "destructive operation", that's expected:
--      one line swaps in a fresh copy of a safety check, and the sign-in
--      counter tidies up its own old entries. No data goes. Confirm to run.
--   4. "Success. No rows returned" means it worked.
--   5. Double-check: open a new query, paste supabase/check-schema.sql and
--      click Run. It answers "All present", or names what's missing.
--   (Or, once this repo is on main: GitHub → Actions → "Apply database
--   upgrade" → Run workflow. It runs this file, then the same check.)
--
-- IF IT STOPS WITH "Two households share a pilot number"
--   Nothing was changed. Open each project it names on /ops/projects, give
--   one of them a different number in its Pilot box, then run this again.
-- =============================================================================

begin;
EOF
  for f in "${files[@]}"; do
    name="$(basename "$f")"
    printf '\n-- =============================================================================\n'
    printf -- '-- %s\n' "$name"
    printf -- '-- =============================================================================\n\n'
    cat "$f"
    # A file without a final newline would glue its last line to the next banner.
    [[ -n "$(tail -c1 "$f")" ]] && echo
  done
  cat <<'EOF'

-- =============================================================================
-- Done: every change above is saved together.
-- =============================================================================
commit;
EOF
}

if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  build >"$tmp"
  if ! cmp -s "$tmp" "$OUT"; then
    echo "build-pilot-upgrade: supabase/pilot-upgrade.sql is out of date with supabase/migrations." >&2
    echo "Run: bash supabase/build-pilot-upgrade.sh" >&2
    exit 1
  fi
  echo "    pilot-upgrade.sql is current (${#files[@]} migrations, $first_name to $last_name)"
else
  build >"$OUT.tmp"
  mv "$OUT.tmp" "$OUT"
  echo "wrote $OUT (${#files[@]} migrations, $first_name to $last_name)"
fi
