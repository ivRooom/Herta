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

-- All non-system schemas in this restored application database are in scope.
-- A runtime schema-CREATE grant outside public is also a cutover NO-GO.
-- PostgreSQL 17 SET ROLE is independent from INHERIT: inspect every
-- SET-reachable role's *effective* privileges, not only runtime's own grants.
-- See PostgreSQL 17 pg_has_role(..., 'SET') and has_*_privilege().
WITH application_schemas AS (
  SELECT n.oid
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_'
),
settable_roles AS (
  SELECT r.oid, r.rolname, r.rolsuper, r.rolcreaterole,
         r.rolcreatedb, r.rolbypassrls
  FROM pg_catalog.pg_roles r
  WHERE pg_catalog.pg_has_role('herta_runtime', r.oid, 'SET')
),
acl_checks AS (
  SELECT
    has_table_privilege('herta_runtime', 'public._prisma_migrations', 'SELECT')
      AS prisma_history_runtime_select,
    has_any_column_privilege('herta_runtime', 'public._prisma_migrations', 'INSERT')
      AS prisma_history_runtime_insert,
    has_any_column_privilege('herta_runtime', 'public._prisma_migrations', 'UPDATE')
      AS prisma_history_runtime_update,
    has_table_privilege('herta_runtime', 'public._prisma_migrations', 'DELETE')
      AS prisma_history_runtime_delete,
    has_table_privilege('herta_runtime', 'public._prisma_migrations', 'TRUNCATE')
      AS prisma_history_runtime_truncate,
    has_table_privilege('herta_runtime', 'public._prisma_migrations', 'TRIGGER')
      AS prisma_history_runtime_trigger,
    has_schema_privilege('herta_runtime', 'public', 'CREATE')
      AS runtime_schema_create,
    EXISTS (
      SELECT 1 FROM application_schemas s
      WHERE has_schema_privilege('herta_runtime', s.oid, 'CREATE')
    ) AS runtime_any_application_schema_create,
    has_database_privilege('herta_runtime', current_database(), 'CREATE')
      AS runtime_database_create,
    -- ADMIN OPTION permits self-regrant with SET TRUE even when the current
    -- membership has SET FALSE. Reject any such edge from runtime or a role
    -- runtime can SET to; do not mutate memberships to discover escalation.
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.admin_option
        AND (m.member = 'herta_runtime'::regrole
          OR m.member IN (SELECT oid FROM settable_roles))
    ) AS runtime_role_admin_option,
    EXISTS (
      SELECT 1 FROM settable_roles r
      WHERE r.rolname IN ('herta_owner', 'herta_migrator')
         OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
         OR has_table_privilege(
           r.oid, 'public._prisma_migrations'::regclass,
           'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'
         )
         OR has_any_column_privilege(
           r.oid, 'public._prisma_migrations'::regclass, 'INSERT,UPDATE'
         )
         OR has_database_privilege(r.oid, current_database(), 'CREATE')
         OR EXISTS (
           SELECT 1 FROM application_schemas s
           WHERE has_schema_privilege(r.oid, s.oid, 'CREATE')
         )
    ) AS runtime_set_role_privilege_escalation
)
SELECT
  acl_checks.*,
  (
    NOT prisma_history_runtime_insert
    AND NOT prisma_history_runtime_update
    AND NOT prisma_history_runtime_delete
    AND NOT prisma_history_runtime_truncate
    AND NOT prisma_history_runtime_trigger
    AND NOT runtime_any_application_schema_create
    AND NOT runtime_database_create
    AND NOT runtime_role_admin_option
    AND NOT runtime_set_role_privilege_escalation
  ) AS prisma_history_acl_gate_pass,
  -- ON_ERROR_STOP=1 exits nonzero for any unsafe privilege.
  1 / CASE WHEN
    NOT prisma_history_runtime_insert
    AND NOT prisma_history_runtime_update
    AND NOT prisma_history_runtime_delete
    AND NOT prisma_history_runtime_truncate
    AND NOT prisma_history_runtime_trigger
    AND NOT runtime_any_application_schema_create
    AND NOT runtime_database_create
    AND NOT runtime_role_admin_option
    AND NOT runtime_set_role_privilege_escalation
    THEN 1 ELSE 0 END AS acl_gate_exit_assertion
FROM acl_checks;

COMMIT;
