#!/usr/bin/env bash
# Copy the local development database (docker compose "postgres", database lpb) into another Postgres,
# e.g. Supabase, exactly: schema, data and Prisma's migration history (so `prisma migrate deploy` there is a no-op).
#
#   1. Put the target connection string in backend/.env as TARGET_DATABASE_URL=...  (never commit it)
#      Supabase: Project -> Connect -> "Session pooler" string (port 5432), with your DB password filled in.
#   2. bash scripts/copy-db.sh            # refuses if the target already has our tables
#
# Uses Postgres client tools inside Docker, so nothing needs installing. The URL is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=${TARGET_DATABASE_URL:-$( (grep -E '^TARGET_DATABASE_URL=' backend/.env || true) | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')}
if [ -z "$TARGET" ]; then echo "TARGET_DATABASE_URL is not set in backend/.env"; exit 1; fi

CLIENT=postgres:17-alpine
DUMP=$(mktemp -d)/lpb.sql
trap 'rm -rf "$(dirname "$DUMP")"' EXIT

echo "1/4 Checking the target is reachable and empty..."
EXISTING=$(docker run --rm -e TARGET="$TARGET" "$CLIENT" sh -c 'psql "$TARGET" -tAc "select count(*) from information_schema.tables where table_schema = '\''public'\'' and table_name in ('\''GenerationRun'\'','\''_prisma_migrations'\'')"')
if [ "$EXISTING" != "0" ]; then
  echo "The target already has this app's tables. Nothing was changed. Empty it first if you really want to overwrite."
  exit 2
fi

echo "2/4 Dumping the local database..."
docker compose exec -T postgres pg_dump -U lpb -d lpb --schema=public --no-owner --no-privileges --no-comments > "$DUMP"
# The target already has a public schema (Supabase manages it); don't try to recreate it.
sed -i -e '/^CREATE SCHEMA public;$/d' -e '/^ALTER SCHEMA public OWNER/d' "$DUMP"
echo "    $(grep -c '^COPY ' "$DUMP") tables, $(wc -c < "$DUMP" | tr -d ' ') bytes"

echo "3/4 Restoring into the target (single transaction)..."
docker run --rm -i -e TARGET="$TARGET" "$CLIENT" sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 --single-transaction -q' < "$DUMP" > /dev/null

echo "4/4 Comparing row counts..."
# exact row counts per table, same query on both sides
TABLES=$(docker compose exec -T postgres psql -U lpb -d lpb -tAc "select string_agg(format('select %L as t, count(*) as n from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname='public'")
LOCAL=$(docker compose exec -T postgres psql -U lpb -d lpb -tA -F= -c "$TABLES order by 1")
REMOTE=$(docker run --rm -e TARGET="$TARGET" -e Q="$TABLES order by 1" "$CLIENT" sh -c 'psql "$TARGET" -tA -F= -c "$Q"')
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "    identical:"; echo "$LOCAL" | sed 's/^/      /'
else
  echo "    MISMATCH"; echo "local:"; echo "$LOCAL"; echo "target:"; echo "$REMOTE"; exit 3
fi
echo "Done."
