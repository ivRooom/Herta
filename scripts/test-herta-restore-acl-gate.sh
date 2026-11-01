#!/usr/bin/env bash
# Offline synthetic ACL regression only. Never points to a production DB.
set -euo pipefail
cd "$(dirname "$0")/.."

image="${HERTA_PG17_FIXTURE_IMAGE:-postgres:17-alpine}"
name="herta-acl-gate-${GITHUB_RUN_ID:-$$}"
scratch="$(mktemp -d)"
cleanup() { docker stop "$name" >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT

docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" >/dev/null
docker run -d --rm --name "$name" --network none --cpus 1 --memory 768m \
  --pids-limit 128 --tmpfs /var/lib/postgresql/data:rw,size=512m \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
for _ in $(seq 1 45); do
  docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null

docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE ROLE herta_owner NOLOGIN;
CREATE ROLE herta_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE herta_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE herta_acl_rehearsal OWNER herta_owner;
SQL

docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal <<'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO herta_migrator;
GRANT USAGE ON SCHEMA public TO herta_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE herta_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO herta_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE herta_migrator IN SCHEMA public
  GRANT SELECT, USAGE ON SEQUENCES TO herta_runtime;
SET ROLE herta_migrator;
CREATE TABLE public._prisma_migrations (id TEXT PRIMARY KEY);
CREATE TABLE public.example_business_table (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
RESET ROLE;
SQL

# The source dump's risk: default ACL grants runtime history-write on restore.
before="$(docker exec "$name" psql -X -At -U postgres -d herta_acl_rehearsal -c "
SELECT (has_table_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
  AND has_table_privilege('herta_runtime', 'public._prisma_migrations', 'UPDATE')
  AND has_table_privilege('herta_runtime', 'public._prisma_migrations', 'DELETE'))::integer")"
test "$before" = "1" || { echo 'Expected pre-remediation history DML risk was not reproduced'; exit 1; }

if docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  < scripts/check-herta-restored-acl.sql > "$scratch/before.txt" 2>&1; then
  echo 'Dangerous ACL was not rejected by the SQL process gate' >&2
  exit 1
fi
grep -q 'division by zero' "$scratch/before.txt" || {
  echo 'ACL gate failed for an unexpected reason, not the forbidden write grants' >&2
  exit 1
}
# Tested candidate, applied only to this throwaway fixture.
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'REVOKE INSERT, UPDATE, DELETE ON TABLE public._prisma_migrations FROM herta_runtime;' >/dev/null
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  < scripts/check-herta-restored-acl.sql > "$scratch/after.txt"
after="$(docker exec "$name" psql -X -At -U postgres -d herta_acl_rehearsal -c "
SELECT (NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
  AND NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'UPDATE')
  AND NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'DELETE')
  AND NOT has_schema_privilege('herta_runtime','public','CREATE')
  AND NOT has_database_privilege('herta_runtime',current_database(),'CREATE'))::integer")"
test "$after" = "1" || { echo 'Expected post-remediation history DML denial was not observed'; exit 1; }
# Regression: TRUNCATE is independent of INSERT/UPDATE/DELETE and can erase
# every Prisma migration-history row. The clean after-REVOKE case must be denied.
expect_acl_rejection() {
  local case_name="$1"
  if docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
    < scripts/check-herta-restored-acl.sql > "$scratch/$case_name.txt" 2>&1; then
    echo "Unsafe ACL gate unexpectedly passed: $case_name" >&2
    exit 1
  fi
  grep -q 'division by zero' "$scratch/$case_name.txt" || {
    echo "ACL gate failed for an unrelated SQL error: $case_name" >&2
    exit 1
  }
}

docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'GRANT TRUNCATE ON public._prisma_migrations TO herta_runtime;' >/dev/null
expect_acl_rejection truncate_only
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'REVOKE TRUNCATE ON public._prisma_migrations FROM herta_runtime;' >/dev/null

# Regression: non-public application schema CREATE must block cutover.
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal <<'SQL'
CREATE SCHEMA herta_auxiliary;
CREATE TABLE herta_auxiliary.application_table (id integer);
GRANT CREATE ON SCHEMA herta_auxiliary TO herta_runtime;
SQL
expect_acl_rejection other_schema_create
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'REVOKE CREATE ON SCHEMA herta_auxiliary FROM herta_runtime;' >/dev/null

# Regression: non-INHERIT membership WITH SET TRUE lets runtime become migrator.
# Direct has_table_privilege(runtime) remains false, but SET ROLE bypasses it.
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'GRANT herta_migrator TO herta_runtime WITH INHERIT FALSE, SET TRUE;' >/dev/null
set_only="$(docker exec "$name" psql -X -At -U postgres -d herta_acl_rehearsal -c "
SELECT (pg_has_role('herta_runtime', 'herta_migrator', 'SET')
  AND NOT pg_has_role('herta_runtime', 'herta_migrator', 'USAGE')
  AND NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
)::integer")"
test "$set_only" = "1" || { echo 'Non-INHERIT SET-only privilege fixture invalid' >&2; exit 1; }
expect_acl_rejection set_only_migrator
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  -c 'REVOKE herta_migrator FROM herta_runtime;' >/dev/null

# The same fixture returns PASS after removing every risky synthetic grant.
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  < scripts/check-herta-restored-acl.sql > "$scratch/final.txt"
grep -Eq '[[:space:]]t[[:space:]]*\\|[[:space:]]*1[[:space:]]*
 "$scratch/final.txt" || {
  echo 'Safe ACL final result missing TRUE/PASS assertion' >&2
  exit 1
}
echo 'Synthetic PG17 ACL DML/TRUNCATE/SET ROLE/other-schema CREATE negative cases and safe case: PASS'
