# PostgreSQL 17 / Prisma client readiness

Preparation for [Herta #512](https://github.com/ivRooom/Herta/issues/512), using
Herta main `49e1e4f`. No production credentials, data export, route, TLS issuance,
role activation, deployment or connection switch is part of this change.

## Reproduce the client acceptance

Run `bash scripts/test-postgresql-prisma-readiness.sh` with Docker/BuildKit.
The image uses the repository lockfile (currently Prisma 6.19.3), Node 22 and
PG17 images pinned by digest. Package installation happens during image build;
the database and test clients have no external network or published ports.
Each database/client container is bounded to 1 GiB, two CPUs and 128 PIDs;
database disk is ephemeral 512 MiB. This is fixture isolation, not a simulation
of the combined 1 GiB production workload. Cleanup removes labeled containers,
the uniquely tagged test image and public certificate copies. CI has a 15-minute
job limit; schema/client runs have 180/90-second limits.

If package installation requires an operator trust bundle, set
`IVRM_TEST_CA_BUNDLE` to its local path. It is a BuildKit secret mount used only
for Node package HTTPS verification, never an image layer. TLS verification is
not disabled. No AWS/SSH credentials or host environment files are mounted.

The server creates one-day disposable certificates and public synthetic
passwords. The migrator and runtime are separate, non-superuser identities;
the owner cannot log in. Native Prisma uses `sslmode=require`,
`sslaccept=strict` and `sslcert=/tls/ca.crt`. A connection using only
`sslmode=require` must not be assumed to verify both CA and hostname.

Local acceptance passed:

- Real native Prisma TLS and full current Prisma schema creation by the fixture migrator.
- Runtime Guild/User/membership CRUD, FK rejection and cascading deletion.
- Runtime DDL denial; wrong CA, hostname and password rejection.
- Plaintext, other-service database and postgres database rejection.

The pool limit of two and three-second connection/pool timeouts are fixture
values. They do not prove production pool capacity, deadline compliance under
load or retry behavior of Bot/API/Worker/Studio. The runtime role limit of eight
is also a fixture value, not an approved production role change.

## Migration history remains a separate gate

This test uses `prisma db push` **only on the disposable empty fixture**. It
does not replay migration SQL, custom SQL CHECK constraints, historical data
repairs or production `_prisma_migrations`. It must never be used as a migration
or incident recovery procedure on a real database.

A separate disposable PG17 probe of actual `prisma migrate deploy` over all
repository migration files stopped at
`20260825022000_suggestion_staff_queue_index`: Prisma P3018 / PostgreSQL 25001,
because historical multi-statement `CREATE INDEX CONCURRENTLY` cannot execute
inside that implicit transaction. This reproduces the historical exception in
[the migration policy](DATABASE_MIGRATIONS.md); it is not a new PG17-only finding.
No existing migration bytes/checksums were changed, no failure was automatically
resolved/retried, and the disposable probe was removed.

The intended migration path restores the real source schema, data **and applied
migration history** together. It must compare all applied checksums and reject
unfinished/unknown migrations before running any newly pending migration.
Replaying immutable history from an empty database is not an accepted shortcut.
Real source PG16-to-PG17 cold restore, CHECK/FK/sequence/index validity,
Guild/IAM/plugin/audit/business acceptance and retained-secret recovery remain
unverified by this test. Source data has not been exported in this phase.

## Required production adapter work

Current Compose and `_common.sh` still assume the local postgres service;
deployment/start/rollback can run the migrator automatically. Merely replacing
DATABASE_URL leaves that dependency and the local volume in operation.

An external mode must preserve local mode, select the same topology in every
deployment/diagnostic/rollback entry point, reject unknown modes and reject
rollback revisions lacking external-mode support. It must inject the migration
URL only into the migrator and runtime URL only into application containers;
do not place both credentials in a shared env_file. Preserve the local source
volume and the current runtime encryption-key recovery path.

Prepare CA mount, stable verified server identity, explicit aggregate pool and
retry budget, external backup/restore ownership and bounded unreachable-DB
behavior before a service-owned cutover. The infrastructure backup record is
[maintained separately](https://github.com/ivRooom/ivrm-infrastructure/blob/main/docs/postgresql-backup-activation-2026-10-26.md).
Do not infer actual private route or certificate renewal acceptance from a local
fixture. Original source databases remain authoritative.

## Review and rollout boundary

Producer/consumer: Herta Prisma client and the dedicated infrastructure PG17
endpoint. API contract version: unchanged. This test/docs/workflow-only change
can merge independently: its paths do not match the current production deploy
allowlist. Recheck the latest workflow before merge. No provider Git deployment
integration is added. A rollback of this preparation simply reverts the test.

Production sequence remains backup acceptance, reviewed private route/CA and
restricted roles, service external-mode acceptance, actual cold restore and
workload/RPO/RTO agreement, then separately approved one-service cutover.
Before application writes, restore prior configuration to roll back; after new
writes, stop writers and reconcile deltas or roll forward. Do not delete the old
database/volume or merely switch URLs back after new writes.
