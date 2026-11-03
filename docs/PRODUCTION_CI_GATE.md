# Production CI-first deployment gate

## Purpose

This is the release quality gate for Herta on AWS Lightsail.
Source of truth: the deployed image SHA and successful GitHub Actions for that exact SHA.

This gate does not authorize new VC recording, 365-day retention, Whisper, or restore quarantine.
See #646 for new feature approval and #694, #695, #728, #729, #730 for deletion and restore safety.

## Automatic deploy

1. A completed **main push CI** triggers `Deploy Production` through `workflow_run` (not the old `push.paths` filter). `workflow_dispatch` remains an independently approved manual path.
2. The read-only gate validates `workflow_run` origin: same GitHub repository, `push` event, main branch, `completed/success`, exact latest main SHA, and valid payload. PR/fork/stale/failed CI never reach build or SSH.
3. The current main commit SHA is pinned. A last **successfully executed production SSH job** with provable automatic main SHA is required as the comparison baseline; GitHub workflow run `head_sha` alone cannot attest the image deployed by a **manual rollback**.
4. Compare the proven production baseline through the pinned main SHA. Runtime source/config/deploy changes require deployment, even when previous main commits were not deployed; docs/Agent Skills/monitoring-only deltas skip build and SSH.
5. Unknown, manual-rollback or unverifiable production baseline, incomplete commit comparison, API outage and stale main **stop** automatic deployment. Do not fallback to the latest commit parent or an inferred image version. See #765 for an auditable post-rollback resume design.
6. The gate requires successful same-SHA main-push CI (including ARM64/SBOM/Grype), Database topology contracts, and conditional isolated PostgreSQL integration for DB/Bot/Studio changes. The PostgreSQL workflow itself runs on **every main push**: a deploy may include Bot/DB changes from earlier commits that never reached production, even when the newest push changed only deployment scripts. This intentionally trades some CI cost for a trustworthy same-SHA gate.
7. CI waiting is bounded to 90 minutes; the outer gate job has a 100-minute limit. All unsuccessful, incomplete or cancelled checks fail closed.
8. The validated immutable SHA is passed to GHCR build/publish and Lightsail SSH. The normal path rejects main branch moves before image publication and before SSH.
9. Preserve `environment: production`, existing AWS OIDC/SSM, migrator and Bot/API/Studio/Worker plus Cloudflare health checks.

**Activation:** After merging the workflow change, confirm `Deploy Production` is enabled in GitHub Actions. Confirm main CI completion actually produces a `workflow_run` event, that its gate accepted the same SHA, and that GHCR image, SSH, migrations and external health pass. A passed CI without a Deploy run is **not** a successful release. If it does not start, stop; do not create an unrelated empty commit or bypass the gate. See #762 / release #759.

Main may move after the final pre-SSH check. Treat this residual race as requiring monitoring rather than an atomic deployment guarantee. If the trigger is disabled or approval is pending, the operator must use the approved Actions UI/Environment process; automatic equivalence is not assumed.

## Human-run rollback

- Open Herta in GitHub Actions and choose Deploy Production.
- Choose **Run workflow** with the workflow branch set to main.
- Enter `main` to deploy current main, or a full 40-character lowercase SHA for rollback.
- An old SHA must belong to main history and have passing main-push CI evidence.
- Missing or incomplete historical CI fails immediately; retry after checks finish.
- PR refs, tags, feature branches and missing CI evidence must be rejected.
- Record the target SHA, previous healthy image and expected impact in the incident Issue.
- Confirm the rollback decision and production Environment approval before execution.
- Never copy secrets, customer identifiers or audio into GitHub Issues.
- Check API, Studio/Auth, Bot, Worker, migrator and external Cloudflare health.
- Confirm the running Bot/API/Studio/Worker image SHAs and Actions run results.

After any historical-SHA manual rollback, the automatic CI-completion workflow is **conservatively blocked** until trustworthy evidence of the actual production SHA can be established (#765). Do not infer it from the manual GitHub workflow run head SHA. Record the running image SHA, approved rollback target and release owner in #759 / incident Issue. An approved manual main deployment is an explicit human action, not proof that automatic provenance is repaired.

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

Tracking: [#700](https://github.com/ivRooom/Herta/issues/700), [#762](https://github.com/ivRooom/Herta/issues/762), [#765](https://github.com/ivRooom/Herta/issues/765).
Release status: [#691](https://github.com/ivRooom/Herta/issues/691).
Feature approval: [#646](https://github.com/ivRooom/Herta/issues/646).
