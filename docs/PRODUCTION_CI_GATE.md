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

### 2026-11-04 protected Status API incident: read-only recovery decision (#765)

**Scope and established evidence.** The [failed production run #41807040824](https://github.com/ivRooom/Herta/actions/runs/41807040824) printed a four-service, same-SHA image-config-ID readback and public health before GitHub proof publication returned HTTP 500. An authorized operator subsequently ran `deploy/scripts/production-proof-audit.mjs` using GET-only GitHub API access. For SHA `7a3e8ed67fefb84014787527910cf500519b6c0d`, run `41807040824`, attempt `1`, the resulting deployment ID was `7542865017` with matching run/attempt and **zero statuses**. This establishes a created record and missing status at the time of inspection; it does not establish the GitHub API's internal 500 cause or current live state.

**Read-only diagnostic sequence (operator):**

1. Use a clean detached worktree for the PR containing the audit CLI; never stash, reset, clean or overwrite the operator's existing staged files. Confirm the worktree SHA and that it contains the reviewed GET-only auditor.
2. Using an authorized GitHub token held in environment memory (never displayed or pasted into an Issue), rerun the audit for exactly the SHA/run/attempt above. Inspect the complete `herta-runtime-attested` deployment history, record ID, latest status and duplicate count. Stop on pagination, authorization or API failure. This audit does not write any GitHub status.
3. Independently authenticate to the known Lightsail host through the approved management path, verify the host identity pin, then read back the current Git SHA and the running `api`, `bot`, `studio`, `worker` image tags/config IDs and container health. Compare to the SHA and Docker config digest recorded by the failed deploy. A historical SSH log is not evidence of the **current** runtime.
4. Recheck external API and Auth.js health, monitoring/error logs, the latest backup, restore readiness, and the tested rollback target. Record evidence without secrets, API tokens, personal data or raw audio.
5. Reconcile GitHub deployment/Status, exact Actions run and attempt, authenticated host readback and backup readiness in [Issue #765](https://github.com/ivRooom/Herta/issues/765). Distinguish **record created**, **status missing**, **release proof accepted** and **runtime verified**; none imply another.
6. Investigate the failed `POST /deployments/{id}/statuses` path using sanitized request IDs and the least-privilege token permissions. If the original run did not log a GitHub request ID, document that it cannot be recovered from the old job output. Decide on a recovery mechanism only after the actual 500 cause and partial-write semantics are understood.

**No-Go until separately approved:** do not rerun the failed deployment workflow (it can create duplicate records or redeploy), create another Deployment, manually add `success` to deployment `7542865017`, disable Ruleset/Environment protection, re-enable a failed quality gate, or perform an emergency rollback without an approved incident plan. The normal proof validator intentionally requires a valid status issued during a successful SSH job; a later manually backfilled status may fail temporal checks even if the host is still healthy. A recovery design must explicitly address that invariant, not bypass it.

**2026-11-05 automated gate evidence and manual-mode boundary.** After main advanced, [Deploy Production run #41957566912](https://github.com/ivRooom/Herta/actions/runs/41957566912) failed the *Verified main CI gate* at `Latest production SSH attempt failed or lacks completed health/proof`. Its image build and SSH deploy jobs were **skipped**: this is an intended fail-closed stop, not evidence that the newer main SHA was deployed. Do not respond by repeatedly dispatching the same run.

The existing `production-quality-gate.mjs` distinguishes the two exceptional manual approvals:
- `DEPLOY_BOOTSTRAP_APPROVED=true` applies only where **no prior production SSH deployment baseline exists**. A recent failed/partial SSH is **not** a first bootstrap.
- `DEPLOY_EMERGENCY_ROLLBACK_APPROVED=true` is a separately approved recovery targeting a **pinned 40-character historical SHA in main ancestry**, not `ref=main` and not an arbitrary PR commit. It still requires historic same-SHA main-push CI, valid workflow checks, protected Environment approval and an independently assessed DB/data rollback plan. The two approval flags are mutually exclusive; neither authorizes a new proof for a failed historic job or permits skipping backup, health or independent owner Go/No-Go.

An operator's November 5 read-only host inspection found the four running Herta services on image tag `7a3e8ed67fefb84014787527910cf500519b6c0d` with identical Docker image config ID `sha256:86f7957db49186a1911dbad25563f2ffa4abf9234d6e75fd04ed6c52df20eec6`; the API and Bot were Docker-healthy. Public API health and Auth.js provider discovery returned valid JSON. These checks do **not** verify Studio/Worker business behavior, the active DB write target, the freshness of a valid PostgreSQL backup, isolated restore, or a production proof. The app Lightsail host had seven successful automatic snapshots in the read-only window, but the dedicated DB host showed none; S3 backup metadata exists without proof of a recent restorable database dump. Track restore readiness in [Herta #506](https://github.com/ivRooom/Herta/issues/506) and [ivrm-infrastructure #3](https://github.com/ivRooom/ivrm-infrastructure/issues/3).

**Exit criteria:** the owner approves the plan; current runtime and health are independently verified; backup/restore/rollback are ready; any recovery PR passes exact-head CI/security checks and review; the official deployment path produces a consistent, unambiguous runtime proof and an independently verified production smoke check. Close #765 only after these have actually completed.

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
