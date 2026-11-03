# Production CI-first deployment gate

## Purpose

This is the release quality gate for Herta on AWS Lightsail.
Source of truth: the deployed image SHA and successful GitHub Actions for that exact SHA.

This gate does not authorize new VC recording, 365-day retention, Whisper, or restore quarantine.
See #646 for new feature approval and #694, #695, #728, #729, #730 for deletion and restore safety.

## Automatic deploy

1. Existing runtime path filters start the Deploy Production workflow on a main push.
2. The read-only Verified main CI gate pins the current main commit SHA.
3. It waits for successful main-push CI and Database topology contracts on the same SHA.
4. DB, Bot, Studio and PostgreSQL workflow changes also require PostgreSQL integration.
5. Failed, cancelled, missing, malformed and unrelated checks are never accepted.
6. CI waiting is bounded to 90 minutes; the outer gate job has a 100-minute limit.
7. The validated SHA is passed to image build, GHCR publish and Lightsail SSH deploy.
8. A changed main SHA stops normal deployment before publishing and before SSH.
9. The existing production Environment, AWS OIDC/SSM and health checks are preserved.

Main may change after the final pre-SSH check.
Treat this as a residual race requiring production monitoring, not an atomicity guarantee.

## Human-run rollback

- Open Herta in GitHub Actions and choose Deploy Production.
- Choose **Run workflow** with the workflow branch set to main.
- Enter `main` to deploy current main, or a full 40-character lowercase SHA for rollback.
- An old SHA must belong to main history and have passing main-push CI evidence.
- PR refs, tags, feature branches and missing CI evidence must be rejected.
- Record the target SHA, previous healthy image and expected impact in the incident Issue.
- Confirm the rollback decision and production Environment approval before execution.
- Never copy secrets, customer identifiers or audio into GitHub Issues.
- Check API, Studio/Auth, Bot, Worker, migrator and external Cloudflare health.
- Confirm the running Bot/API/Studio/Worker image SHAs and Actions run results.

A failed GitHub API, unavailable runner, rejected CI or missing approval is a stop condition.
Do not add a quality-gate bypass or disable environment protection to clear an alert.
Use the human-approved incident and recovery procedure instead.

## Verification

- `node --test deploy/scripts/production-quality-gate.test.mjs`
- `CI`: format, lint, typecheck, tests, build, SBOM, Grype and ARM64.
- `Database topology contracts`: deployment and gate contract checks.
- `VALORANT PostgreSQL integration`: required for DB, Bot or Studio changes.

These tests verify metadata and workflow contracts.
They do not prove privacy-safe restore or full deletion of historical user data.
External GitHub Environment and OIDC settings require human review.

Tracking: [#700](https://github.com/ivRooom/Herta/issues/700).
Release status: [#691](https://github.com/ivRooom/Herta/issues/691).
Feature approval: [#646](https://github.com/ivRooom/Herta/issues/646).
