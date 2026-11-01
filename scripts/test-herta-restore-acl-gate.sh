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

docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d herta_acl_rehearsal \
  < scripts/check-herta-restored-acl.sql > "$scratch/before.txt"
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
echo 'Synthetic PG17 ACL pre-risk reproduced and post-REVOKE denied: PASS'
