#!/usr/bin/env bash
# Build a throwaway database from the migration, then prove two things about it:
#
#   1. the row-level policies really do isolate one user from another
#   2. every column the app's queries name actually exists
#
# Needs a Postgres 16 server you can reach. Point PGURL at one, or let this
# start a local cluster:
#
#   ./supabase/tests/run.sh
#   PGURL=postgres://localhost/selflight_test ./supabase/tests/run.sh
#
# It never touches your Supabase project.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="${TMPDIR:-/tmp}/selflight-schema-test"

if [ -n "${PGURL:-}" ]; then
  psql() { command psql "$PGURL" "$@"; }
else
  bin="${PGBIN:-/usr/lib/postgresql/16/bin}"
  [ -x "$bin/initdb" ] || { echo "No Postgres at $bin. Set PGBIN or PGURL."; exit 2; }

  # A cluster of its own, so nothing here can reach a database you care about.
  data="$work/data"
  sock="$work/sock"
  rm -rf "$work"
  mkdir -p "$data" "$sock"

  owner="$(id -un)"
  if [ "$(id -u)" = "0" ]; then
    owner=postgres            # Postgres refuses to run as root.
    chown -R postgres:postgres "$work"
  fi
  as() { if [ "$owner" = "$(id -un)" ]; then "$@"; else su "$owner" -c "$(printf '%q ' "$@")"; fi; }

  as "$bin/initdb" -D "$data" -A trust >/dev/null
  as "$bin/pg_ctl" -D "$data" -o "-k $sock -c listen_addresses=" -l "$data/server.log" start >/dev/null
  trap 'as "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true' EXIT

  as "$bin/createdb" -h "$sock" selflight_test
  psql() { as "$bin/psql" -h "$sock" -d selflight_test "$@"; }
fi

echo "=== applying the migration ==="
# shim.sql supplies only the slice of Supabase the migration leans on: an auth
# schema, auth.uid(), and the three roles. Table grants deliberately come from
# the migration, so this proves the migration stands on its own.
psql -q -v ON_ERROR_STOP=1 -f "$here/shim.sql" -f "$repo/supabase/migrations/0001_init.sql" 2>&1 |
  grep -v 'NOTICE' || true

echo
echo "=== row-level security ==="
# ON_ERROR_STOP because every failure the suite *expects* is caught inside a
# plpgsql block. Anything that reaches psql is a surprise, and a surprise that
# scrolls past is how a check quietly stops checking anything.
psql -q -v ON_ERROR_STOP=1 -f "$here/rls.sql" | tee "$work/rls.out" | grep -E '^\||^\+' || true

grep -q '| ok ' "$work/rls.out" || { echo; echo "Row-level security checks FAILED."; exit 1; }

echo
echo "=== code against schema ==="
psql -Atq -c "select table_name || '.' || column_name
              from information_schema.columns
              where table_schema = 'public'" > "$work/schema.txt"

node "$here/contract.mjs" "$work/schema.txt" "$repo/src/lib" "$repo/api"
