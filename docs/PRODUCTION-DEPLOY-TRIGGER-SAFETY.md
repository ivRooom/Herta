# Production deployment trigger safety

## Status / boundaries

This document describes **proposed** behavior until the PR is merged. Verify the current `.github/workflows/deploy-production.yml` on main before relying on it.

- Automatic production deployment is triggered by changes to runtime/deployment inputs on `main`, not by docs-only / `.agents/skills/**` / `AGENTS.md` changes.
- `workflow_dispatch` remains available. Starting a dispatch is an explicit production action and still requires operator approval.
- The GitHub Actions `deploy` job uses the `production` Environment. Whether its protection rules require approval is an **external GitHub Environment setting**; do not assume approval is configured based on its name alone.
- Workflow-only changes are **not** part of the automatic deploy allowlist. In particular, merging the trigger-gate PR itself should not start production deployment **via this workflow**. A change to deployment workflow behavior must receive explicit review and a separately authorized `workflow_dispatch` before it affects production. Verify other external integrations independently.
- Build context uses `COPY . .`; `.dockerignore` excludes `*.md`, `docs`, and `.github`. The path allowlist deliberately includes `apps/**`, `packages/**`, `plugins/**`, `contracts/**`, `deploy/**`, certificates and build/configuration files; update the list whenever the Docker build or runtime gains a new input.
- GitHub's event `paths` filter is **not** a permission boundary. Other workflows, Git integrations, or manual server changes may still deploy. Confirm all production release paths before interpreting a docs-only merge as entirely free of production changes.

## Test plan before merge

1. Confirm workflow YAML is valid; CI for the PR is green.
2. Confirm the only changed auto-trigger behavior is `push main` paths; `workflow_dispatch`, job permissions, deploy scripts and runtime secret handling are unchanged.
3. Reason through these events using the GitHub Actions paths filter:
   - `.agents/skills/herta-plugin-lifecycle/SKILL.md` or `docs/PLUGIN_RUNTIME.md` only => no automatic deploy.
   - `apps/bot/src/**` / `packages/db/**` / `plugins/**` => deploy.
   - `Dockerfile`, `docker-compose.prod.yml`, `deploy/scripts/**` => deploy.
   - `.github/workflows/deploy-production.yml` alone => no automatic deploy; manually dispatch an approved release if the changed workflow behavior needs activation.
   - A mixed docs+runtime commit => deploy.
4. Before authorizing an actual production deployment (including `workflow_dispatch`), confirm deployment health, backup/restore access, release rollback, and required reviewers/branch protection in GitHub's actual Environment settings.
5. After merge, validate by observing the Actions run and application health. Do not perform an artificial production restart solely for the test.

## Rollback

Restore the previous workflow through a reviewed PR. **Do not** revert directly to the previous unconditional `push main` trigger: that may immediately redeploy production. Prefer retaining the safe path filter, correcting it in a follow-up PR, and using an approved manual dispatch if a real runtime release is required.

Tracking: [ivRooom/ivrm-platform#40](https://github.com/ivRooom/ivrm-platform/issues/40) / [Herta #507](https://github.com/ivRooom/Herta/pull/507).
