# Herta production deployment — Lightsail / GHCR

> Reviewed against GitHub `main` on 2026-10-29. This describes the
> **repository deployment procedure**, not the state of a running host,
> current GitHub Secrets, active Cloudflare DNS, or an approval to deploy.
> Re-check the exact code, workflow, provider environment and production
> rollback evidence before making any change.

Human-readable architecture and current service responsibilities:
[Herta Notion guide](https://app.notion.com/p/4087322f39fa81659838db12884251a8).

## Canonical source files

| Purpose | GitHub source |
| --- | --- |
| Production build, GHCR push, deploy trigger and smoke | [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml) |
| Runtime and topology | [`docker-compose.prod.yml`](../docker-compose.prod.yml), [`docker-compose.common.yml`](../docker-compose.common.yml) |
| Explicitly approved external DB mode | [`docker-compose.external.yml`](../docker-compose.external.yml), [external database adapter](EXTERNAL_POSTGRESQL_ADAPTER.md) |
| Manual deploy | [`deploy/scripts/deploy.sh`](../deploy/scripts/deploy.sh) |
| Start, rollback, common safety checks | [`start.sh`](../deploy/scripts/start.sh), [`rollback.sh`](../deploy/scripts/rollback.sh), [`_common.sh`](../deploy/scripts/_common.sh) |
| Database schema policy | [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) |
| Backup/restore safety | [`BACKUP_RESTORE_VERIFICATION.md`](BACKUP_RESTORE_VERIFICATION.md) |

## Build and deployment boundaries

1. `Deploy Production` is **path-filtered for `main` push events**:
   changes to runtime inputs such as `apps/**`, `packages/**`,
   `plugins/**`, Compose, Dockerfile, and dependency definitions are
   eligible. Documentation-only changes under `docs/**` are **not**
   a trigger. Always inspect the actual workflow path allowlist.
2. The GitHub Actions `build-image` job creates the Docker image and
   publishes `ghcr.io/ivrooom/herta:<commit SHA>` to GHCR. The
   deploy step connects to Lightsail via SSH, checks the protected
   target revision and database topology, authenticates to GHCR,
   **pulls the prebuilt image**, starts services and verifies health.
   The production server does **not** build the monorepo image.
3. `workflow_dispatch` can run the workflow manually with a requested
   `ref`. Validate the target commit, intended image and
   compatibility **before** running the workflow. A manual trigger
   is a production-changing operation, not merely a dry-run.
4. The initial `deploy/scripts/start.sh` uses a prebuilt GHCR image,
   defaulting to a `:latest` tag if `HERTA_IMAGE` is unset. For a
   controlled release, record and verify the **immutable SHA tag**
   and known-good rollback image rather than relying on `:latest`.
5. Deployment scripts use `.env.production` with protected credentials,
   `HERTA_DATABASE_MODE`, and topology-aware Compose selection.
   Never publish secrets, a private database IP/password or `.env`
   contents into Notion, GitHub Issue/PR, or diagnostic logs.

This is an explanation of existing code, **not** confirmation that
provider-side variables/secrets, SSH permissions, image retention
or currently running containers have been checked during this edit.

## Database and migration guard

- The default `docker-compose.prod.yml` is **local PostgreSQL 16**.
  The dedicated PostgreSQL 17 preparation is **separate**. The
  [2026-10-28 isolated real-backup restore acceptance](https://github.com/ivRooom/ivrm-infrastructure/blob/main/docs/postgresql-herta-restore-62-acceptance-2026-10-28.md)
  and [private TLS-route validation](https://github.com/ivRooom/ivrm-infrastructure/blob/main/docs/postgresql-herta-private-route-acceptance-2026-10-28.md)
  explicitly did **not** switch production application writes to PG17.
- The `external` Compose configuration is an opt-in topology for
  **separately reviewed cutover only**. `prisma migrate status`
  in the external readiness container must not be mistaken for
  permission to execute production DDL or switch `DATABASE_URL`.
- Confirm actual production DB mode, volume preservation, fresh
  backup **and tested restore**, migration history, roles/TLS,
  application and worker integration, last known good images,
  rollback compatibility and incident owner before approving release.
- `prisma migrate deploy` is forward-only. Rolling back an image
  does not reverse a destructive schema change. Follow the
  [database migration runbook](DATABASE_MIGRATIONS.md) and
  a separately approved restore or forward-repair plan when needed.

## Release and rollback checklist

1. Compare the intended commit and changed paths with `main`,
   the exact-head CI, pending reviews, security findings and
   relevant consumer compatibility.
2. Read-only verify the GitHub production workflow/environment,
   AWS Lightsail host and GHCR image SHA, Cloudflare edge route,
   live DB topology, monitoring, free resources and verified backups.
3. Obtain explicit authorization for the **named** production release
   and specify rollback image, checks and failure thresholds.
4. Use the canonical `Deploy Production` workflow. Observe
   image publication, target verification, migration and service
   health, then independently verify the external `herta.ivrm.jp`
   route and bot/worker behavior without exposing credentials.
5. On failure, follow [`deploy/scripts/rollback.sh`](../deploy/scripts/rollback.sh)
   with an explicit topology-compatible commit/image.
   External DB mode prohibits an implicit one-commit rollback.
   Do not reset databases or delete volumes to make a rollback pass.

## Historical procedure (do not execute)

The former document described a server-side `docker compose build`,
unconditional main-push deployment, and an older
`git pull → build → up -d` sequence. These are **not** the
current workflow contract. Preserve the original for debugging:

- [Original GitHub file at the immutable pre-update commit](https://github.com/ivRooom/Herta/blob/cdd28e64d6603b64c200876d1383acfbff492f06/docs/DEPLOYMENT_LIGHTSAIL.md)
- [Full Historical record in private Notion](https://app.notion.com/p/4087322f39fa815f9368ec15d4827ef6)

The source code, not this narrative, remains the final authority
for exact command behavior. Verify any operational procedure against
the source at release time.
