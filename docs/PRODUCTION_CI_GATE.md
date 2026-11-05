# Production CI-first deployment gate

## Purpose

This is the release quality gate for Herta on AWS Lightsail.
Source of truth: the deployed image SHA and successful GitHub Actions for that exact SHA.

This gate does not authorize new VC recording, 365-day retention, Whisper, or restore quarantine.
See #646 for new feature approval and #694, #695, #728, #729, #730 for deletion and restore safety.

## Automatic deploy

1. A completed **main push CI** triggers `Deploy Production` through `workflow_run` (not the old `push.paths` filter). `workflow_dispatch` remains an independently approved manual path.
2. The read-only gate validates `workflow_run` origin: same GitHub repository, `push` event, main branch, `completed/success`, exact latest main SHA, and valid payload. PR/fork/stale/failed CI never reach build or SSH.
3. The current main commit SHA is pinned. A uniquely verified protected runtime deployment record, tied to the **last SSH attempt** and its real image ID, is required as the comparison baseline; GitHub workflow run `head_sha` never attests the deployed rollback image.
4. Compare the proven production baseline through the pinned main SHA. Runtime source/config/deploy changes require deployment, even when previous main commits were not deployed; docs/Agent Skills/monitoring-only deltas skip build and SSH.
5. Unknown, failed newer SSH attempt, manual-rollback without proof, unverifiable baseline, incomplete commit comparison, API outage and stale main **stop** automatic deployment. Do not fallback to the latest commit parent or an inferred image version. See #765 for an auditable post-rollback resume design.
6. The gate requires successful same-SHA main-push CI (including ARM64/SBOM/Grype), Database topology contracts, and conditional isolated PostgreSQL integration for DB/Bot/Studio changes. The PostgreSQL workflow itself runs on **every main push**: a deploy may include Bot/DB changes from earlier commits that never reached production, even when the newest push changed only deployment scripts. This intentionally trades some CI cost for a trustworthy same-SHA gate.
7. CI waiting is bounded to 90 minutes; the outer gate job has a 100-minute limit. All unsuccessful, incomplete or cancelled checks fail closed.
8. The validated immutable SHA is passed to GHCR build/publish and Lightsail SSH. The normal path rejects main branch moves before image publication and before SSH.
9. Preserve `environment: production`, existing AWS OIDC/SSM, migrator and Bot/API/Studio/Worker plus Cloudflare health checks.

**Activation:** After merging the workflow change, confirm `Deploy Production` is enabled in GitHub Actions. Confirm main CI completion actually produces a `workflow_run` event, that its gate accepted the same SHA, and that GHCR image, SSH, migrations and external health pass. A passed CI without a Deploy run is **not** a successful release. If it does not start, stop; do not create an unrelated empty commit or bypass the gate. See #762 / release #759.

Main may move after the final pre-SSH check. Treat this residual race as requiring monitoring rather than an atomic deployment guarantee. If the trigger is disabled or approval is pending, the operator must use the approved Actions UI/Environment process; automatic equivalence is not assumed.

### SSH host identity trust anchor (Issue #770)

The post-SSH image-ID readback is **not a trustworthy release attestation**
without authenticating the server. Both `appleboy/ssh-action@v1.2.5` calls
(the mutating deploy and the subsequent read-only readback) therefore pin
**the same independently verified Lightsail host public-key SHA256 fingerprint**.
A missing or malformed pin causes the protected `deploy` job to fail before
SSM secret access or any SSH operation. The workflow does not fall back to
an unverified connection.

Operator setup (requires human verification and GitHub Environment approval):

1. Open the **actual Lightsail instance** using an independently authenticated
   AWS/Lightsail browser-console session, not the existing unpinned SSH
   action and not `ssh-keyscan` alone. Check the instance identity in AWS.
2. On that instance, inspect the SSH server's **public** host key with
   `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256`.
   Confirm the host offers this key for SSH negotiation; if a different
   algorithm is used, independently verify the corresponding host public key.
   Copy only the `SHA256:...` token (no key material, IP, or usernames).
3. In the repository's **Settings → Environments → production → Environment
   variables**, create `LIGHTSAIL_SSH_FINGERPRINT` with that exact token.
   Keep the protected Environment's reviewer/approval policy. A host
   fingerprint is public-key metadata; do not store any SSH private key there.
4. Before an explicitly approved manual bootstrap (`Deploy Production`,
   `ref=main`), verify the main SHA, its CI, backup/rollback reference,
   and that this key matches the expected Lightsail host. If unknown, stop:
   do not temporarily remove the pin or deploy by SSH without verification.
5. For planned host-key rotation, first verify the new key from the independent
   console, change the protected Environment variable under approval, and
   record the maintenance window and recovery decision in #770/#759.
   An unexpected mismatch means **stop deployment**, investigate host identity,
   and leave healthy containers untouched; never accept the scanned key.

Neither an unapproved Privacy release nor new VC recording is authorized by
setting this variable.

## Verified runtime SHA provenance (Issue #765)

The GitHub Actions run's `head_sha` is **not** proof of the actually
deployed SHA, especially when `workflow_dispatch.inputs.ref` is an older
rollback commit.

After **successful production SSH deploy and external Cloudflare health**,
the environment-protected `deploy` job performs a second **read-only SSH**
session. On Lightsail, it verifies the Git checkout commit equals the exact
pinned 40-digit release SHA and each running `api`, `bot`, `studio`,
`worker` container uses `ghcr.io/ivrooom/herta:<SHA>`. It also verifies
all four containers' Docker image config IDs (`sha256:...`) are equal to the
locally inspected immutable image ID. This Docker config digest is a
**host-side image ID, not a GHCR manifest digest**.

Only after that check succeeds does a protected GitHub Actions job create a
non-secret deployment record with `task=deploy:runtime-proof` in the
**dedicated** GitHub environment `herta-runtime-attested`, then mark its
deployment status `success`. The payload contains the real SHA, image tag,
image config digest, required services, actor, run ID/attempt, and production
environment. The job alone has `deployments:write` permission; the
unprivileged quality gate has `deployments:read`. The record itself does
not trigger a deploy and is **not** a substitute for the protected
`environment: production` approval, OIDC, same-SHA CI and health checks.

Automatic deploys inspect the latest SSH **attempt**, including unsuccessful
workflow runs. A later failed/partial SSH, external-health failure, missing
proof, failed/missing status, duplicate/ambiguous record, incomplete history
or API failure blocks automatic build/SSH; never fall back to an older
successful run or guess a SHA from dispatch metadata. When the latest
successful SSH job has a unique verifiable proof, the quality gate compares
**that actual runtime SHA** to current main. Exact-SHA and docs-only deltas
skip build/SSH; runtime changes require same-SHA main CI and appropriate
PostgreSQL conformance.

**Bootstrap / operator action:** existing production runs from before this
change have no protected runtime proof. The first automatic deployment after
merge will intentionally fail closed. Use the existing
[Deploy Production](https://github.com/ivRooom/Herta/actions/workflows/deploy-production.yml)
manual workflow (`ref=main`) with protected production Environment
approval to run the validated same-SHA build→SSH→Cloudflare→host-readback
sequence **once**. This records the initial proof. Check the actual
`herta-runtime-attested` record and image ID before approving subsequent
automatic deploys. For historical rollback, use a full ancestor commit SHA
and accept the same CI + environment + post-health proof requirements;
never infer the rollback target from workflow run `head_sha`.

**Rollback:** on any mismatch, stop further automatic deployment; do not
override quality gate or access AWS as Root. Confirm healthy image, retain
existing DB backup/restore safeguards, and perform an explicitly authorized
manual protected rollback. After the rollback's new runtime proof exists,
the next normal CI may compare actual rollback SHA to latest main.
The proof contains no secrets, raw audio, ticket contents, or PII.

### Acceptance tests

- `node --test deploy/scripts/production-provenance.test.mjs`
- `node --test deploy/scripts/production-quality-gate.test.mjs`
- Same-head CI including ARM64 SBOM/Grype and conditional isolated PostgreSQL
- Latest SSH attempt validation, manual rollback, stale/duplicate/failed proof,
  partial deploy, withheld GitHub permissions, and missing artifact fail closed
- Lightsail four-container readback, Cloudflare health, protected GitHub
  deployment status, and follow-up automatic run behavior

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

After any historical-SHA manual rollback, the automatic CI-completion workflow is **conservatively blocked** until the protected post-health Lightsail image readback and corresponding deployment proof of the actual SHA have succeeded (#765). Do not infer it from the manual GitHub workflow run head SHA. Record the running image SHA, approved rollback target and release owner in #759 / incident Issue. An approved manual main deployment is an explicit human action, not proof that automatic provenance is repaired.

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

## Incident: GitHub Deployment created but no status (2026-11-05)

This section is a **read-only incident triage**, not authorization to deploy, to
retroactively mark a failed release successful, or to bypass the production
Environment. Tracking: [#765](https://github.com/ivRooom/Herta/issues/765).

### Evidence and distinction

For the 2026-11-04 failed [Deploy Production run
#41807040824](https://github.com/ivRooom/Herta/actions/runs/41807040824),
an operator's authenticated read-only audit reported:

- Expected SHA: `7a3e8ed67fefb84014787527910cf500519b6c0d`
- Run ID: `41807040824`; attempt: `1`
- GitHub Deployment ID: `7542865017`
- The Deployment run/attempt matched; the returned statuses array was empty.

This establishes an existing, **partial** Deployment record at the time of
that audit. It does **not** independently establish the current running host
SHA, the present Deployment status, backup restorability, or a successful
protected release. Never replace a failed SSH or status-publication result
with a success status created after the original job.

### Read-only GitHub checks (PowerShell)

Use an authenticated GitHub CLI session with access to this repository. These
commands only **GET** GitHub data; they do not publish statuses or trigger jobs.
Do not paste authentication tokens or sensitive response fields into Issues.

```powershell
$repo = "ivRooom/Herta"
$run = gh api "repos/$repo/actions/runs/41807040824" |
  ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $run) {
  throw "Cannot verify original Actions run; stop."
}
$deployment = gh api "repos/$repo/deployments/7542865017" |
  ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $deployment) {
  throw "Cannot verify original Deployment; stop."
}
$statuses = @(gh api "repos/$repo/deployments/7542865017/statuses?per_page=100" |
  ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) {
  throw "Cannot verify Deployment statuses; stop."
}
[pscustomobject]@{
  RunId = $run.id
  RunAttempt = $run.run_attempt
  RunConclusion = $run.conclusion
  DeploymentId = $deployment.id
  DeploymentSha = $deployment.sha
  StatusCountFirstPage = $statuses.Count
}
```

The status endpoint is paginated. A full audit must refuse incomplete
pagination, unexpected records, mismatched run/attempt, API errors, and unknown
status values. Prefer the PR #819 read-only
`deploy/scripts/production-proof-audit.mjs` for exhaustive audit, after
reviewing the exact PR HEAD. Do not interpret the abbreviated GET above as a
complete proof when the first page contains 100 records.

### Mandatory operator evidence before any release decision

1. Verify the **current** Bot/API/Studio/Worker image refs and immutable image
   IDs on Lightsail via an approved read-only channel, and compare to
   the expected SHA and signed/source-matched provenance. Check health and
   recent errors, including the known Prisma P2010 incident [#559](https://github.com/ivRooom/Herta/issues/559).
2. Check most recent Lightsail snapshot date, PostgreSQL data backup,
   restore-test evidence, rollback image and their ownership. A visible
   snapshot is **not** proof of successful restoration.
3. Review current GitHub production Environment approval and required
   CI/ARM64/Grype rules. Snyk's optional free-tier quota does not authorize
   bypassing required security checks.
4. Record run/attempt, deployment/status observations, host SHA/image IDs,
   backup/restore confidence, approver, rollback target, and the **GO/NO-GO**
   decision in #765. Omit all secrets and personal data.

**NO-GO if** the host cannot be authenticated/read back, a required backup
cannot be trusted, the existing proof is partial/ambiguous, the latest SSH
attempt is unsuccessful, API pagination is incomplete, or approval is missing.

### Recovery boundary

The original run failed after SSH/health/readback and before complete
protected proof publication. The trust gate intentionally checks the latest
SSH attempt and requires a timely status from a successful run. Creating a
`success` status today for that old failed run cannot satisfy the same
trust boundary and would misrepresent historical release provenance.

Any **new** production deployment, even to the same SHA, requires a separately
reviewed incident recovery design, documented authorization, verified backup
and rollback readiness, passing exact-SHA CI, and approval through the existing
protected workflow. Do not use `bootstrap_without_proof` as a shortcut:
that option is for instances with no prior production SSH deployment.
`emergency_rollback_without_proof` is not a forward-deployment bypass.
Do not invoke `Re-run failed jobs` on the prior SSH deployment as a repair.
Keep #765 open until a new, independently verifiable proof and live smoke/UAT
have been established.
