# Production deployment CI quality gate (#700)

## Scope and source of truth

Herta `main` → GitHub Actions `Deploy Production` → GHCR → AWS Lightsail. The **source of truth** is the actual merge commit SHA, the successful Actions checks for that same SHA, and the SSH/health evidence, not the last successful PR run.

This change only guards deployment orchestration. It **does not** authorize VC Recap long-term recording, Whisper, retention changes, PostgreSQL restore, S3 deletion, or new AWS/IAM resources. Release approval remains #646; restore/erasure contracts remain #694/#695/#728/#729/#730.

## Automatic main deployment

1. The existing runtime-path allowlist triggers `Deploy Production`; docs-only commits do not deploy.
2. `Verified main CI gate` has read-only GitHub permissions (`contents:read`, `actions:read`), no production environment or AWS OIDC access. It pins `GITHUB_SHA` and checks the GitHub API to reject a superseded `main` revision.
3. It verifies successful **main push** workflow runs for the *exact SHA*: `CI` (format/lint/typecheck/tests/build/SBOM/Grype/ARM64) and `Database topology contracts`; when the changed file list touches `packages/db`, `apps/bot`, `apps/studio`, or the PG workflow itself, it also requires `VALORANT PostgreSQL integration` (isolated PostgreSQL).
4. A required check that is pending waits; failed/cancelled/unknown or malformed metadata fails closed. Timeout is bounded to 90 minutes, with a 100-minute job ceiling to cover queued 60-minute ARM64 scans.
5. Only a successful gate emits an immutable commit SHA. Build and GHCR push use that SHA. Before publishing and again before SSH, automation compares current `main` to pinned SHA; a superseded normal deployment aborts. A move after the final pre-SSH check remains an operational race to monitor, not a guarantee of global atomicity.
6. The existing `production` GitHub Environment, AWS OIDC/SSM, Lightsail SSH deploy, internal API/Auth/Discord Bot health and external Cloudflare health checks remain in place.

A green `Deploy Production` job **alone** never constitutes proof that the service is safe for future VC recording or that main's CI is complete. Keep and cross-check workflow run URLs, deployed image SHA for Bot/API/Studio/Worker, migrator status, and health evidence in the relevant release Issue.

## Manual recovery and rollback

- Open GitHub → Herta → Actions → **Deploy Production** → **Run workflow**, with the *workflow ref set to main*. Specify `ref=main` for the latest revision, or an exact 40-character lowercase SHA from the reachable `main` history for **explicit rollback**. PR/feature refs, tags, non-main commits and malformed inputs are rejected.
- The selected SHA must have successful prior main-push CI/Topology and any required PostgreSQL workflow. Old history missing adequate checks is intentionally **not** accepted by this automated workflow. A bypass is **not** an authorized GitHub Actions parameter.
- Confirm the requested SHA, prior known-good image, expected cost/impact, security-scanning evidence and operator approval in the incident/release Issue **before starting** a manual production rollback. Review production Environment protection/approvals. Never paste credentials or customer content into Issues.
- When the GitHub API, CI, runner, required Workflow or production environment is unavailable, the automated pipeline must stop before secrets/SSH; do not disable quality checks to clear the alert. Use the documented human-owned incident recovery procedure and approved rollback decision, with a separate reviewed change to any emergency override.
- Observe `Deploy Production` and same-SHA `CI`, `Database topology contracts`, conditional PostgreSQL checks, then external health. Unexpected failures: do not turn on new feature flags; record the exact last-known-good release and stop further deployment pending triage.

## Security boundaries, tests and limitations

- Synthetic contract tests: `node --test deploy/scripts/production-quality-gate.test.mjs`. They reject PR-run/different SHA/branch, failing and cancelled runs, incomplete compares, malformed refs, and distinguish latest workflow run versus an old successful rerun. Also registered in `CI` and `Database topology contracts`.
- The workflow has no source of independent identity/proof beyond GitHub metadata. This is an operational release quality gate, **not** an external VC erasure Ledger or restore Quarantine.
- GitHub Environment configuration, branch protection, Secret and OIDC trust policy are external settings and must be reviewed read-only by a human with access; this PR does not claim to verify their deployed configuration or change them.
- A main workflow that cannot complete within the bound (including ARM64 scan) prevents deployment; treat a missing result as a release blocker, not success.

Refs: [#700](https://github.com/ivRooom/Herta/issues/700), [#691](https://github.com/ivRooom/Herta/issues/691), [#646](https://github.com/ivRooom/Herta/issues/646).
