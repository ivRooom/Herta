-- Herta PG17 restore ACL acceptance. READ ONLY; never changes application data.
-- Run with psql -X -v ON_ERROR_STOP=1 -d herta_acl_rehearsal -f <this file>
-- Only on a known isolated restore first. Requires herta_runtime role and
-- restored public._prisma_migrations; errors are NO-GO, not permission PASS.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS inspected_database,
       current_setting('server_version') AS postgres_version;

-- Aggregates only: no roles' secrets, row contents, IDs, or connection strings.
SELECT
  count(*) FILTER (WHERE c.relkind IN ('r','p')) AS public_tables,
  count(*) FILTER (WHERE c.relkind = 'S') AS public_sequences,
  count(*) FILTER (
    WHERE c.relkind = 'S'
      AND NOT has_sequence_privilege('herta_runtime', c.oid, 'USAGE')
  ) AS runtime_sequences_missing_usage,
  count(*) FILTER (
    WHERE c.relkind IN ('r','p')
      AND c.relname <> '_prisma_migrations'
      AND NOT has_table_privilege('herta_runtime', c.oid, 'SELECT')
  ) AS runtime_tables_missing_select
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public';

-- Effective privileges include grants via role membership and PUBLIC.
-- Any true write/create privilege is a STOP condition for cutover.
SELECT
  has_table_privilege('herta_runtime', 'public._prisma_migrations', 'SELECT')
    AS prisma_history_runtime_select,
  has_table_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
    AS prisma_history_runtime_insert,
  has_table_privilege('herta_runtime', 'public._prisma_migrations', 'UPDATE')
    AS prisma_history_runtime_update,
  has_table_privilege('herta_runtime', 'public._prisma_migrations', 'DELETE')
    AS prisma_history_runtime_delete,
  has_schema_privilege('herta_runtime', 'public', 'CREATE')
    AS runtime_schema_create,
  has_database_privilege('herta_runtime', current_database(), 'CREATE')
    AS runtime_database_create,
  (
    NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
    AND NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'UPDATE')
    AND NOT has_table_privilege('herta_runtime', 'public._prisma_migrations', 'DELETE')
    AND NOT has_schema_privilege('herta_runtime', 'public', 'CREATE')
    AND NOT has_database_privilege('herta_runtime', current_database(), 'CREATE')
  ) AS prisma_history_acl_gate_pass;

COMMIT;
