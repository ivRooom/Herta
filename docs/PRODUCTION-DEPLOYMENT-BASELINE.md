# Herta production deployment and database boundaries

Reviewed: 2026-10-26. This page is a source-based index, not an assertion of a live rollout.

## Deployment ownership

The [production workflow](../.github/workflows/deploy-production.yml) builds and validates the runtime image on a GitHub-hosted runner, pushes a commit-SHA image to GHCR, and deploys to Lightsail with AWS OIDC, SSM SecureString and SSH.

The [production Compose file](../docker-compose.prod.yml) and deployment scripts own the exact commands. The [older Lightsail guide](DEPLOYMENT_LIGHTSAIL.md) retains historical setup instructions, now marked as such. A documentation-only change is not among the production workflow's automatic push paths.

## Database boundary

Current Compose declares local PostgreSQL 16, Redis 7 and a Prisma migrator. Its app dependencies expect the local PostgreSQL health check. Changing only the database URL is not a tested PostgreSQL migration.

The dedicated PostgreSQL 17 Lightsail has four initially empty databases. The S3 backup destination exists, but backup IAM, credentials, timers, real capture and independent timed restore are not activated merely by merging preparation code.

The real source-data migration, strict TLS/CA/hostname validation, role isolation, pooling, rehearsal and cutover need separate approval. Track [Herta issue 512](https://github.com/ivRooom/Herta/issues/512) and [Platform issue 52](https://github.com/ivRooom/ivrm-platform/issues/52).

## Release controls

Review exact-head CI, requested changes and unresolved threads. Confirm image provenance, health and rollback. Application image rollback is not database rollback. Keep credentials, internal addresses, data and state out of documentation.
