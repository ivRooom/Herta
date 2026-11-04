# Herta PG17 cutover boundaries (#675)

This first operator-tooling change adds the sequential admission/recovery core, Source-local durable writer fence, independent watchdog core and owned local systemd process containment. It does not install or execute a production cutover.

## Problem and behavior

The previous production attempt restored the original writers after manual handoff exhausted the transfer admission window. A sequential coordinator needs durable start/recovery exclusion and actual process containment before automated handoff can be accepted.

- The controller admits only measured, pinned phase budgets and preserves recovery inside the original Source deadline. Existing PREPARED fences require conservatively mapped local deadlines; remote BOOTTIME and coordinator monotonic clocks must not be compared directly.
- The Source fence serializes PREPARED/FROZEN, business START_INTENT and RECOVERY_INTENT. START_INTENT never authorizes automatic old-Source restart. Private registry reservations, hash-chained receipts and boot IDs preserve ambiguity across process loss.
- Owned transient systemd units pin actor bytes and operation identity, enforce runtime/cgroup limits and verify exact owned cgroup emptiness. Local process death does not prove Docker jobs, PostgreSQL backends or remote requests stopped.

## Validation and limits

Local controller19, Source fence23, process-unit11 and watchdog26 tests pass. Tests cover deadline exhaustion, lost acknowledgements, competing processes, durable reservations and foreign unit rejection. No SQL/cloud operation or application writer is started by the unit suites.

These libraries require separately verified approval pins, protected paths, actual Source freeze/watchdog, cancellation-aware nonblocking providers, remote quiescence, env rollback and live recovery evidence. Those providers and full unaccelerated cutover rehearsal are follow-up work under #675. Migration capture/transfer/restore/crypto/backup helpers remain in the separate operator worktree until subsequent reviewed changes. No production execute entrypoint is added here.

## Order and rollback

Producer/consumer: Herta operator libraries only; no service API/event contract changes. Merge this foundation before the Source/Target provider changes; production deployment must be prevented for this tooling merge. Reverting these unused tooling files removes the foundation without changing runtime configuration. Actual cutover, DDL, cost and old DB retirement retain their separate approvals. PG16 and Supabase dependency elimination are not accepted by this PR.

The explicit local systemd integration fixture is included because the process-unit safety test imports its cleanup guard. CI does not execute real systemd units or the integration fixture main function.

The watchdog also preserves >40 seconds for Source recovery. Its quiescence child receives the full Source end (needed by env rollback), while the parent enforces an earlier execution limit reserving 41 seconds; local timeout is still not remote-stop evidence. Real local adapter deadline/timeout and systemd containment tests passed, with service recovery proofs explicitly synthetic.

## Current required checks (#700)

The initial review observed five required contexts, including path-filtered Studio/PostgreSQL jobs. While this PR was under CI, the maintainer corrected the active main ruleset to the normal and ARM64 CI jobs only, with strict latest-main tracking. The proposed manual workflow_dispatch additions are therefore removed from this PR. No repository rule is changed here. See GITHUB_MAIN_RULESET_SOLO_RUNBOOK.md and live GitHub rules for the current operational state. Applicable topology and integration checks remain part of review even when not globally required.

## Existing automatic deployment boundary

The current runtime-change classifier includes deploy/, so these unused Python tools can still cause Deploy Production (workflow307693350) to consider build/GHCR/SSH after main CI. No-production-change approval therefore requires an explicit operational pause, not merely a docs-only intention: after confirming no queued/in-progress deployment, disable/read back that existing workflow before merge; verify all approved main checks complete; confirm no deployment for the merge SHA; then restore/read back the originally active workflow. Do not merge until that temporary automation-state change is authorized. This does not weaken quality checks or change deployed app/DB configuration.

After the disabled-state readback, re-enumerate all nonterminal Deploy runs (queued/in_progress/waiting/pending/requested) before merge: disabling does not cancel a run that raced the initial check. Abort merge if any exists; do not cancel another deployment. Repeat before re-enable and verify the exact merge SHA has no deployment.
