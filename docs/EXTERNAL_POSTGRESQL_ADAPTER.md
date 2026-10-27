# External PostgreSQL adapter

Status: implementation preparation for #512. No production cutover is performed by this document or PR. Existing deployments default to `HERTA_DATABASE_MODE=local` and retain the PostgreSQL 16 service, volume, migration command and application environment.

## Topology and credentials

`docker-compose.common.yml` holds shared services. `docker-compose.prod.yml` is the local entry point; `docker-compose.external.yml` omits PostgreSQL entirely. Use the deployment scripts, which select the entry point from the protected `.env.production`, instead of maintaining a separate Compose command.

Before an approved external cutover, pin `COMPOSE_PROJECT_NAME` to the current production project's exact name. Preserve the existing Redis and proxy volume namespace. Set `HERTA_DATABASE_MODE=external`, `HERTA_DATABASE_PRIVATE_IP` to the approved RFC1918 server address, and `HERTA_DATABASE_CA_FILE` to the absolute public CA bundle path readable by the image's node user. The file must exist; bind mounts never create a directory as a replacement. Do not place private CA keys in this file.

Runtime `DATABASE_URL` uses `herta_runtime`; `MIGRATION_DATABASE_URL` uses a distinct `herta_migrator` password and is supplied only to the readiness container. Both URLs must use `postgresql`, hostname `ivrm-db-postgres.internal`, explicit port 5432 and database `herta`. Percent-encode credential components. Required query parameters, each exactly once:

| Parameter        | Runtime                     | Migrator                    |
| ---------------- | --------------------------- | --------------------------- |
| schema           | public                      | public                      |
| sslmode          | require                     | require                     |
| sslaccept        | strict                      | strict                      |
| sslcert          | /run/ivrm/postgresql-ca.crt | /run/ivrm/postgresql-ca.crt |
| connect_timeout  | 3                           | 3                           |
| pool_timeout     | 3                           | 3                           |
| connection_limit | 2                           | 1                           |

No other query parameters are accepted. All four applications and the readiness container receive the read-only public CA and fixed hostname mapping. The offline validator checks URL policy and CA format/validity; Prisma's actual TLS handshake checks server trust. A nominal four pools of two connections is not measured capacity acceptance: validate process/bundle pool multiplicity, monitoring/admin headroom and workload against the server's 30-connection budget before cutover.

## Deployment, diagnostics and rollback

External deployments recreate a stopped migrator and run configuration validation plus a bounded `prisma migrate status`. A running migrator blocks deployment. External ordinary deployment never runs `migrate deploy`; pending migration history must be resolved through a separately reviewed and approved DDL operation. Existing immutable SQL history is unchanged. A history status check does not prove absence of schema drift or application correctness.

External startup omits orphan deletion, and forces `COMPOSE_REMOVE_ORPHANS=false` even if the shell or protected env requests deletion. The old source PostgreSQL container and volume remain available. External `stop.sh --volumes`, raw Compose logs and rendered non-quiet config are blocked; diagnostics omit raw application logs and database history. Inspect failures through an approved private operator procedure. This does not turn the shell account into a security sandbox.

Manual deployment and the SSH workflow validate the target before checkout or secret writes. External rollback requires an explicit topology-compatible revision. Revisions predating this adapter are rejected; do not bypass the guard by switching mode to local. Rollback never reverses SQL. If the database history is newer than the target artifact, prepare a compatible roll-forward or reviewed compatible rollback artifact rather than resetting history. Preserve the current configuration and previous image reference before any approved release.

Merging this PR triggers the existing production deployment workflow. Release approval is separate from this code preparation. The first release must retain local mode; the later external cutover requires its own network, TLS, role/secret, fresh backup, migration and application acceptance package.

## Evidence and remaining gates

Offline checks: normalized local Compose equality against `1941b7e` (except the explicit local-mode guard), external rendering without POSTGRES settings, no source service/dependency/volume, credential separation and CA mounts; URL/CA rejection tests; mode/legacy-target/orphan/secret-error/running-migrator tests; existing deploy helper tests. CI runs these contracts separately from the main application pipeline. No schema or migration SQL changes are introduced.

The earlier isolated real-backup acceptance is recorded in [Infrastructure restore acceptance](https://github.com/ivRooom/ivrm-infrastructure/blob/main/docs/postgresql-herta-restore-acceptance-2026-10-27.md). Its fixed snapshot is not a final quiesced migration backup. Subsequent service schema changes require a fresh matching rehearsal before cutover.

Still required: actual production Compose/runtime compatibility; private route and strict TLS including renewal; least-privilege LOGIN roles and secret delivery; runtime-user handshake and full API/Bot/Studio/Worker behavior; load/pool/memory acceptance; agreed RPO/RTO; final quiesced backup/count/checksum reconciliation; cutover and rollback rehearsal. No old DB or Supabase resources may be deleted based on these offline tests.
