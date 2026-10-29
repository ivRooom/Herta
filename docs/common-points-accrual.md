# Common points: frozen accrual and source outbox primitives

Human design/acceptance canonical document: [Notion](https://app.notion.com/p/4087322f39fa81f6b819e45352926837).
This code-backed document retains transaction constraints, commands and operator safety gates.

Tracking: Herta#569 / #538, Web#598, Platform#103. Depends on Herta PR570
client/Contracts v1 and Web PR599 receiver. This staged patch wires Bot/shared
and Studio achievement sources behind a separately disabled accrual flag. It
does not yet wire ordinary message/session/participation/poll activity, enable
the sender, switch UI reads, seed/enable policy, or apply a production migration.
The MBTI completion/achievement transaction and source dedupe fixes also apply
while accrual is disabled; no common credit is then recorded.

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

### Connected achievement sources

Bot automatic unlocks delegate to shared DB logic; Studio's existing shared MBTI
unlock and manual grant use that same accrual hook. It requires
`HERTA_COMMON_POINTS_ACCRUAL_ENABLED=true` **and** matching `HERTA_POINTS_GUILD_ID`.
Without that flag/match it never queries the new points tables. No production
flag/Secret was set by this patch. Candidate IDs are deduped and only actual
INSERT success can earn. A permanent guild/user/achievement claim prevents
regrant credit; revoke changes the achievement state without rewriting/debiting
the common wallet. Corrections to common balances use the audited Web admin API.

Studio Web MBTI now includes the server-fixed achievement ID in its existing
completion transaction: session/history/stats/achievement/outbox all commit or
all roll back. The history/stats and persisted session subject/guild/result must
match. It no longer swallows a separate post-commit achievement failure. Already
completed historical sessions are not automatically repaired/credited; inventory
and approved owner backfill remain migration tasks.

Before enabling, seed zero-credit source tombstones for pre-cutoff awards
included in the opening/import or already awarded by the common system, using
`achievementCommonPointSourceId`. Inspect revocation audit history as well as
visible unlocks: deleted/revoked rows do not prove whether a prior award exists.
If adopting once-ever eligibility across legacy history, unknown prior awards
must remain unresolved for adjudication. A guild baseline flag alone cannot
certify claim completeness or absence of overlap.

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
once. The opt-in Bot sender refreshes only the signature timestamp, leases
bounded batches, acknowledges verified successful receipts, retries uncertain
delivery, holds unlinked identities, quarantines conflicts and exposes age/lag.
Actual production enablement and full-source acceptance remain release blockers.
These tables are transport/accrual state; spendable balance belongs to Web.

### Delivery and recovery

The Bot starts/stops the outbox worker only when existing common-points client
configuration resolves (`COMMON_POINTS_ENABLED=true`, dedicated points key and
guild); no flag/key is set by this PR. Disabled startup performs no points DB or
HTTP operation. Claim also requires enabled/baseline-complete source policy.
Each cycle claims at most5 events with SKIP LOCKED/30s leases, sends at most5
concurrently outside SQL transactions, then schedules the next cycle5s after
completion. Shutdown stops scheduling and awaits the active cycle.

Claim/settlement/health use bounded short DB transactions; transport timeout5s,
request/response8192-byte bounds and fixed api.ivrm.jp with redirects rejected.
Full v1 wire/body SHA256 validation precedes sending. Failed delivery retries
the exact stored event/body with5s–1h backoff; auth failure waits at least5min,
unlinked409 at least1min. HTTP404 is retained. No attempt-count drop. Known
payload/epoch/receipt conflicts quarantine immutable data for reviewed recovery.
Malformed success is not an ACK. Verified ACK stores remote transaction/user
references; ACK state and payload cannot be edited/reset/deleted.

Settlement explicitly locks its row before checking `clock_timestamp()` expiry
and lease token. Transaction-start CURRENT_TIMESTAMP can incorrectly accept an
ACK that waited across expiry; the native regression reproduces that old fence
as a negative control and rejects it after the fix. Source bodies/receipt totals
are retained across lease crash/reclaim. Health logs only aggregate pending /
quarantined count/oldest age; warnings throttle to once per minute and never log
IDs, payloads, secret, SQL errors or auth headers. No external email is sent.

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
  src/common-points-accrual.test.ts src/common-points-achievement.test.ts \
  src/common-points-outbox.integration.test.ts
```

Eight pure tests plus the real PostgreSQL17/Prisma integration passed. The first
cohort measures32 source mutations =32 receipts, total1,000,067; after actual
achievement/MBTI cases and a synthetic imported-claim tombstone, final
**36 receipts / outbox total1,000,097 synthetic points** agree. Covers20 concurrent writes, eight same-event
retries, changed-input rejection, property-order-independent input hash,
source, late outbox and post-helper outer-transaction failure rollback/retry,
zero credits, daily caps, seeded
partial time/caps and chunk splitting. Actual shared source functions test eight
concurrent unlocks, duplicate/blocked IDs, regrant/imported claim suppression,
achievement and MBTI late-outbox rollback/retry, wrong-subject rejection and one
completion history. Native source tables are initialized from the current schema
excluding only the four new models, using db push to an explicit synthetic
loopback URL, then the real new migration is applied. Production URL environment
is never selected. Owner-labelled container and temporary schema are removed.
This is synthetic source evidence, not production money or actual Discord/browser
delivery. The PG fixture is opt-in, not ordinary CI.

Sender14 unit tests pass, including the shared nine negative contract fixtures,
lost transport/retry,404/auth/unlinked retention, conflict quarantine, malformed
ACK bounds and disabled no-op. Native PG also verifies disjoint concurrent
leases, token/expiry fencing, crash reclaim with unchanged bytes, terminal ACK,
retry/quarantine and health. Separate Web real-PG test with the actual compiled
Herta sender simulated receiver COMMIT followed by lost response, then retry:
one receipt, Herta/member/admin each160, ledger160. This does not exercise the
real network or live browser screens; no production state was changed.

Prisma schema validation passed with a synthetic unreachable URL (no DB access).
The first real PG run caught Prisma's inability to deserialize advisory-lock
`void`; the lock now selects an integer from the lock function and the rerun
passed. Windows historical migration-policy checksum test fails on existing CRLF
bytes (4pass/1fail); no historical SQL was edited and no checksum/test was relaxed.
Final Linux CI must validate the branch; no full-suite-green claim is made here.
