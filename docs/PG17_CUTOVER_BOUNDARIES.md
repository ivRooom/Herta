# Herta PG17 cutover boundaries (#675)

This first operator-tooling change adds the sequential admission/recovery core, Source-local durable writer fence, independent watchdog core and owned local systemd process containment. It does not install or execute a production cutover.

## Problem and behavior

The previous production attempt restored the original writers after manual handoff exhausted the transfer admission window. A sequential coordinator needs durable start/recovery exclusion and actual process containment before automated handoff can be accepted.

- The controller admits only measured, pinned phase budgets and preserves recovery inside the original Source deadline. Existing PREPARED fences require conservatively mapped local deadlines; remote BOOTTIME and coordinator monotonic clocks must not be compared directly.
- The Source fence serializes PREPARED/FROZEN, business START_INTENT and RECOVERY_INTENT. START_INTENT never authorizes automatic old-Source restart. Private registry reservations, hash-chained receipts and boot IDs preserve ambiguity across process loss.
- Owned transient systemd units pin actor bytes and operation identity, enforce runtime/cgroup limits and verify exact owned cgroup emptiness. Local process death does not prove Docker jobs, PostgreSQL backends or remote requests stopped.

## Validation and limits

Local controller19, Source fence23, process-unit11 and watchdog22 tests pass. Tests cover deadline exhaustion, lost acknowledgements, competing processes, durable reservations and foreign unit rejection. No SQL/cloud operation or application writer is started by the unit suites.

These libraries require separately verified approval pins, protected paths, actual Source freeze/watchdog, cancellation-aware nonblocking providers, remote quiescence, env rollback and live recovery evidence. Those providers and full unaccelerated cutover rehearsal are follow-up work under #675. Migration capture/transfer/restore/crypto/backup helpers remain in the separate operator worktree until subsequent reviewed changes. No production execute entrypoint is added here.

## Order and rollback

Producer/consumer: Herta operator libraries only; no service API/event contract changes. Merge this foundation before the Source/Target provider changes; no production deploy follows this merge. Reverting these unused tooling files removes the foundation without changing runtime configuration. Actual cutover, DDL, cost and old DB retirement retain their separate approvals. PG16 and Supabase dependency elimination are not accepted by this PR.

The explicit local systemd integration fixture is included because the process-unit safety test imports its cleanup guard. CI does not execute real systemd units or the integration fixture main function.
