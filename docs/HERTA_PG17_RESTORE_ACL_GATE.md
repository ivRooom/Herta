# Herta PG17 Restore ACL gate — 2026-11-01

Owner: [Herta #675](https://github.com/ivRooom/Herta/issues/675) / [Platform #143](https://github.com/ivRooom/ivrm-platform/issues/143).

**State: source-controlled inspection only; NOT an executed restore, remediation, or production approval.** Existing isolated PG17 restore 101 tables / 69 applied Prisma migrations, source checksum, strict TLS and HBA /32 are independently documented in #675. Do not reclassify those as a final cutover. The currently live Herta DB remains the old local PostgreSQL 16 until actual cutover verification.

## Risk and why this gate exists

The dedicated PG17 host has `herta_owner`/`herta_migrator` default table ACL rules granting `herta_runtime` SELECT/INSERT/UPDATE/DELETE for *new tables created by those roles*. Restoring the PG16 source using `pg_restore --no-owner --no-acl` as `herta_migrator` may therefore grant write access to `public._prisma_migrations`. The role should not rewrite Prisma's immutable migration history.

An isolated restore that checks only table counts and Prisma checksums **does not** establish the effective runtime grants on restored objects. An ACL inspection of the empty target DB also does not prove post-restore grants.

## Required nonproduction rehearsal

1. Use **a separate resource already authorized for this test**, not either production Herta or the 1 GiB shared Lightsail DB. Use a fresh disposable PostgreSQL 17 image pinned by digest, no published port/network, bounded CPU/RAM, and secure temporary storage. Never attach the real production database directly.
2. Privately obtain the existing verified **SOURCE** Herta dump, verify the expected exact S3 object version/byte length/SHA256 on the operator's isolated machine, and check it is the PG16 source capture, **not** the tiny empty `herta.dump` from the target PG17 backup bucket. The 2026-11-01 03:00 JST copy was 3,024,343 bytes, SHA256 `a63113a549518929299c90787eba7f65a0f9dfbc5a9a3a337100f2d75dcfcd00`; it is **not** the final writer-frozen backup.
3. In disposable PG17 create `herta_acl_rehearsal` with `herta_owner`, `herta_migrator`, `herta_runtime` permissions and default ACL matching the **latest read-only target inspection**, including role memberships and grants. Restore the verified capture as the actual intended **migrator current role** using `pg_restore --exit-on-error --no-owner --no-acl`. A superuser restore is not equivalent.
4. Run **read-only**:
   ```bash
   psql -X -v ON_ERROR_STOP=1 -d herta_acl_rehearsal \
     -f scripts/check-herta-restored-acl.sql
   ```
   The operator must explicitly target the disposable database. Stop immediately if the expected database, roles, schema or `_prisma_migrations` is absent. Do not echo a production DSN, usernames' passwords, a source row or raw HBA CIDR.
5. Review counts and effective grants. For every ordinary table, assess actual runtime DML requirements separately; **do not grant broad CRUD** solely to satisfy this check. Confirm sequence usage, Prisma migration checksum and count, FK/index, actual Prisma application behavior and encryption compatibility using the linked #675 gates.

### ACL acceptance

| Inspect output | Required for ACL gate |
| --- | --- |
| `prisma_history_runtime_insert/update/delete` | **false** each |
| `runtime_schema_create`, `runtime_database_create` | **false** each |
| `prisma_history_acl_gate_pass` | **true** |
| `public_tables` and source schema | match the exact source snapshot, historically 101 (not a hardcoded constant) |
| `runtime_sequences_missing_usage` / `runtime_tables_missing_select` | analyze against application access requirements; do not claim all accesses need CRUD |
| Any missing relation/role or SQL error | **NO-GO**, never interpret as success |

**Expected risk:** With the currently observed blanket default table ACL, the first rehearsal may report `prisma_history_runtime_insert/update/delete=true`; this is a hypothesis to test, **not** a completed PASS or FAIL.

### If the history-write gate fails

**Do not cut over production.** Add a reviewed, target-`herta`-only post-restore permission step to the operator change plan. Candidate SQL, **for review and disposable rehearsal only** (not an instruction to run against production now):

```sql
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public._prisma_migrations
  FROM herta_runtime;
```

Because access can also come from role membership, PUBLIC or another grant, this candidate is not an automatic solution: rerun the effective-privilege inspection and confirm all three history DML privileges are false. If not, inspect grant provenance and redesign least privilege. The remediation must not modify the Prisma migration rows, checksum, owner of unrelated databases, or global role/default ACL for `ivrm_ai`/`ivrm_web`. Treat audit/secret-bearing tables separately; do not blanket-grant or blanket-revoke application permissions without an application test.

After approving the exact method, rehearse **restore → target-only ACL adjustment → post-check → application CRUD/RBAC/Prisma** in isolation. Include the specific post-restore SQL and its source revision in a separate scoped production operator approval, before any final restore.

## Production cutover remains independently gated

- Confirm 1 GiB shared host's observed RAM, disk/WAL headroom, live connections, backups/restoration and S3 restore readiness; avoid new paid snapshots/instances without separate approval.
- Stop **all** Bot/API/Studio/Worker/scheduler writers on old PG16; prove quiescence, then capture a **new** final source backup with immutable S3 version/hash and inspect consistency.
- Restore only `herta` from that final capture; never overwrite `ivrm_ai` or `ivrm_web`. Run this ACL check against the restored target **before** runtime writers start, together with checksum/index/FK/grant checks and the approved post-restore adjustment if required.
- Verify intended application runtime roles with Prisma and actual durable CRUD, Discord interactions, encryption/key reuse, health and audit/queue state. Keep old PG16, Redis, encryption keys, and final backup intact.
- If a failure occurs before writes resume, revert the service topology to the frozen old source. **After new legitimate writes on PG17, never switch back to an older snapshot without explicit differential reconciliation**; stop relevant writers and prefer reviewed roll-forward.
- Web's separate Supabase→Lightsail migration, feature flags, independent daily participation release and ordinary 00:00 JST observation are **not** completed by this Herta ACL gate.

## Evidence to post on #675 and Platform #143

Record only: current Herta main SHA, isolated image digest, anonymized source object version reference or hash, restored table/migration/index/FK totals, ACL booleans, effective-grant risk classification, test time, peer review and No-Go/Go recommendation. Do **not** post dump, user rows, connection strings, secrets, live internal addresses, or HBA files.

No production actions were executed by adding this document or inspection SQL.
