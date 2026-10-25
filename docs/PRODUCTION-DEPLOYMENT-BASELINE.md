# Herta production deployment and database boundaries — 2026-10-26

## Source and certainty
- Current **code**: [deploy-production.yml](../.github/workflows/deploy-production.yml), [docker-compose.prod.yml](../docker-compose.prod.yml), [Prisma schema](../packages/db/prisma/schema.prisma).
- Deployment **runtime** must be verified by latest Actions/instance configuration; repository code by itself does not certify the live host.
- [Old Lightsail guide](DEPLOYMENT_LIGHTSAIL.md) contains historical setup sections; use its current correction notice first.

## Image delivery
1. Workflow `push to main` runs only for runtime-affecting paths; docs-only changes are excluded. Manual `workflow_dispatch` accepts an explicit ref.
2. Build-image job uses `docker/build-push-action`, checks expected artifacts and non-root image execution, pushes a commit-SHA-pinned image to `ghcr.io/ivrooom/herta`.
3. Deploy job assumes AWS role via OIDC, retrieves required selected runtime values from SSM SecureString, and uses the production GitHub Environment + SSH to operate Lightsail.
4. Exact deployment, rollback, error-handling and secret-writing semantics are owned by the Workflow and deploy scripts; never replace that procedure with a historical ad hoc `docker compose build`.

## Database and state
`docker-compose.prod.yml` presently declares `postgres:16-alpine`, local `postgres_data`, `redis:7-alpine` and a Prisma migrator. It references the local postgres healthcheck as an explicit dependency for the running app. `DATABASE_URL` switching alone is **not** a validated remote-DB migration strategy.

The separately created dedicated PostgreSQL17+pgvector Lightsail has service-isolated **empty** databases. The S3 backup destination exists, while automation/IAM/credential delivery/timers and independent timed restore remain inactive pending approval and live tests. Herta production migration is tracked by [Herta #512](https://github.com/ivRooom/Herta/issues/512) and [Platform #52](https://github.com/ivRooom/ivrm-platform/issues/52).

## Release / change gates
- CI and independent review for the precise head SHA, unresolved review threads and requested changes.
- Image provenance/digest, health checks, dependency compatibility (Postgres/Redis/migrations), no unexpected Secret changes.
- Document and rehearse rollback (app image rollback is not DB migration rollback).
- DB schema/migrator modifications require backup and recovery plan and separate production approval.
- Never paste live credentials, internal hosts, query results with personal data or Terraform state into documentation.

This page is a source-oriented baseline, not an assertion that any particular production rollout was carried out.
