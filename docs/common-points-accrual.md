# Common points: frozen accrual and source outbox primitives

Tracking: Herta#569 / #538, Web#598, Platform#103. Depends on Herta PR570
client/Contracts v1 and Web PR599 receiver. This staged patch does not wire Bot
or Studio source hooks, run a sender, switch UI reads, seed or enable policy, or
apply a production migration. Existing runtime behavior is unchanged until those
call sites and reviewed rollout gates are implemented.

## Fixed calculation

`freezeCommonPointsTariff` copies all16 tariff/cap fields, validates integers,
freezes the copy and hashes UTF-8 JSON of `{formula,rates}` with sorted rate keys.
Formula is `herta-jst-daily-v1`. Use this exact hash as enrolled `ruleVersion`.
The tariff must be captured/reviewed with the opening cutoff; later guild config
edits do not alter it. Changing a tariff requires a separate prospective policy
decision/migration; this version intentionally refuses in-place policy edits.

Per guild/Discord user/JST day/metric, credit `value(afterUnits)-value(beforeUnits)`.
Messages and each reaction direction multiply counts by frozen rates; voice
floors seconds/600; online/game floor seconds/3600. Online/game/commands/LFG/
TeamSplit/poll cap **points**, including the final partial cap. Game counters
aggregate all activity names before flooring/capping. Achievement units count
only accepted new unlocks; blocked or re-granted achievements need stable native
identity decisions at their actual source hooks. XP, Minecraft duration,
character units, season/challenge scores and badges cannot mint through this API.
Use BigInt; do not round increments independently or turn profile snapshots into
credits. A zero-point increment still persists its source receipt and counter.

At the cutoff seed all relevant current-day counters from reviewed source data,
including partial hours and already consumed caps, before marking
`baseline_complete`. That flag is an operator assertion, not an automatic proof.
Settle/split active sessions at the cutoff/JST midnight before calling the
primitive. Each increment's timestamp must identify the actual credited bucket;
a single session ending today must not place yesterday's duration into today.

## Transaction and retry boundary

`commitCommonPointAccrual(prisma,input,mutateSource)` acquires the enabled frozen
policy FOR SHARE, source-identity advisory lock and daily-counter FOR UPDATE.
It persists the callback's source mutation, updated units, immutable receipt and
outbox in one Prisma transaction. The callback must use the supplied transaction
client only; no external IO or nested transaction. A failure even after source
and receipt insertion rolls everything back. Lock wait/statement/transaction
timeouts bound the operation. Never independently retry an uncertain commit
with a new source ID: repeat the exact stable source ID, units and timestamp.

For source owners that already have a transaction (session chunks, participation,
polls, achievements), use `commitCommonPointAccrualInTransaction` with its actual
transaction client and a callback capturing that same client. Its narrow raw-SQL
capability type avoids forcing plugin owners to cast a limited delegate to the
entire Prisma client. It never opens/commits a nested transaction or changes the
owner's timeouts. TypeScript's structural typing cannot prove a client is inside
a transaction: never pass a root Prisma client; review the owner boundary and
test failure after helper completion. The owner must set bounded timeouts.

Receipt uniqueness is guild/Discord user/metric/native source ID; changed input
with the same identity fails. Replay skips the callback. Missing/disabled policy,
incomplete baseline and pre-cutoff input reject **before** callback execution:
future hooks must preserve the legacy source path while disabled/pre-cutoff,
and must not catch an enabled-path failure then blindly apply legacy increments.
Design source dedupe around actual Discord event identity; generated UUIDs on
each delivery do not dedupe source redelivery. Incoming events not durably
accepted by a source hook are not covered by outbox delivery guarantees.

Positive credit is split into at most64 events of at most1,000,000 points. Event
UUID, stable earning ID, exact JSON body/hash, epoch and tariff hash are stored
once. A future sender must refresh only the signature timestamp, lease bounded
batches, acknowledge only verified successful receipts, retry uncertain delivery,
hold unlinked identities, quarantine conflicts and expose pending age/lag.
Worker/ACK implementation is still a release blocker, not supplied by this patch.
These tables are transport/accrual state; spendable balance belongs to Web.

## Migration and rollback

New expand-only migration `20261029000000_add_common_points_source_outbox`
creates four tables, uniqueness/index/FK/check constraints and policy/history/
payload/counter guards. No historical migration or source table is rewritten.
Policies default disabled with baseline incomplete. Native SQL is used for the
primitive; Prisma schema describes the same tables. Production DDL, approved
baseline seed/enablement, grants, Secret delivery, deploy and later retirement
are individually controlled under Web#598. Do not merge this PR without the
specific production approval: Herta main push can redeploy apps and migration
ownership must be checked in the deployment package.

Before any accepted credits, keep the old compatible image/config and source
backups. After common credits, stop sender/writers, preserve counters, receipts,
outbox and Web ledger, reconcile and roll forward. Do not drop the new tables,
reset counters, delete receipts, edit payloads or URL-switch to stale balances.
Independent source/target backup restore and live all-screen acceptance remain
required; isolated fixtures do not prove production migration acceptance.

## Executed validation

```bash
pnpm install --frozen-lockfile --offline --ignore-scripts
pnpm --filter @herta/db exec prisma generate
pnpm --filter @herta/db typecheck
pnpm --filter @herta/db build
pnpm --filter @herta/db exec tsx --test src/common-points-accrual.test.ts
# Local Docker; cached image only, loopback, tmpfs, memory384MiB, no cloud access.
HERTA_RUN_PG_POINTS_TESTS=1 pnpm --filter @herta/db exec tsx --test \
  src/common-points-accrual.test.ts src/common-points-outbox.integration.test.ts
```

Five pure tests plus the real PostgreSQL17/Prisma integration passed. Measured32
source mutations =32 immutable receipts; pending outbox total = receipt total
**1,000,067 synthetic points**. Covers20 concurrent writes, eight same-event
retries, changed-input rejection, property-order-independent input hash,
source, late outbox and post-helper outer-transaction failure rollback/retry,
zero credits, daily caps, seeded
partial time/caps and chunk splitting. Fixture container was owner-label checked
and removed. This is source-side synthetic evidence, not production money or
actual Bot/Studio event processing. The PG fixture is opt-in, not ordinary CI.

Prisma schema validation passed with a synthetic unreachable URL (no DB access).
The first real PG run caught Prisma's inability to deserialize advisory-lock
`void`; the lock now selects an integer from the lock function and the rerun
passed. Windows historical migration-policy checksum test fails on existing CRLF
bytes (4pass/1fail); no historical SQL was edited and no checksum/test was relaxed.
Final Linux CI must validate the branch; no full-suite-green claim is made here.
