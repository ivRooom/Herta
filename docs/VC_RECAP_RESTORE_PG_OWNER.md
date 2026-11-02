# VC Recap restore owner-lock PostgreSQL adapter (Issue #729)

> Status: **isolated PostgreSQL test adapter only — NOT a production restore executor**.
> This is not evidence that a restored DB, S3, voice transcript or backup copy is safe to serve.

## What this change proves

- `packages/db/src/vc-recap-restore-pg-owner.ts` exposes the three operations
  expected by the **synthetic** `deploy/scripts/vc-recap-restore-fence-replay.mjs`:
  `readFence`, `upsertFenceAndRevoke`, `verifyFenceAndRevocations`.
- The adapter holds `lockVcRecapStorageOwner` for a single user throughout
  one real Prisma PostgreSQL transaction, reusing the lock shared by consent
  revocations and future S3 storage reservations.
- A replay never lowers `requestedAt`, always clears the untrusted
  `storageDeletionVerifiedAt`, revokes legacy voice and retention consent and
  **every** new purpose (including OpenAI processing), while leaving reserved
  storage objects visible and blocking future reservation commit through the
  erasure row. The database CHECK allows only `reserved` or `committed`.
- The adapter verifies the database state **before commit**. When any
  `reserved` row remains, `pendingWritesCancelled=false`; the caller MUST
  reject the incomplete proof and roll back, retaining external quarantine.
  An exception aborts the transaction, and the public error excludes owner IDs.
- `vc-recap-restore-pg-owner.integration.test.ts` runs exclusively with
  `HERTA_VALORANT_TEST_DATABASE_URL` targeting localhost `/valorant_test`
  and is executed by `VALORANT PostgreSQL integration`. It uses synthetic IDs
  and synthetic keys, never an AWS SDK or production database.

## Precision limitation (fail closed)

`vc_recap_erasure_requests.requested_at` is currently
`@db.Timestamptz(3)`; Prisma `Date` is limited to millisecond precision.
An external snapshot with nonzero digits below milliseconds
(for example `2026-11-02T07:00:00.123001Z`) cannot be represented without
data loss, so the adapter **rejects** it rather than silently rounding or
claiming a successful monotonic replay.

Before #729 can be completed, the independent ledger's timestamp contract,
database timestamp precision and Prisma adapter must be reconciled and tested
with actual microsecond ordering. No schema migration is part of this PR.

## What this does NOT do

- Does not authenticate a signed external ledger or prove its completeness
  (#694); the caller must verify the source before invoking the adapter.
- Does not own or establish durable, independent quarantine (#728/#734);
  no other process is prevented from reading/writing VC data by this adapter.
- Does not cancel an S3 PUT already in flight, enumerate all owner copies,
  purge all versions/multipart/cache/summary/backups or prove deletion
  (#730/#617). The DB erasure row blocks a future reserve/commit but
  **cannot** cancel a remote PUT already started. A remaining `reserved`
  row therefore denies a successful replay proof; no purge is inferred.
- Does not enable long-term enrollment, recording, Whisper, or restore traffic.
  It is intentionally **not** imported from Bot, API, Studio or Worker.
- Does not run a production backup restore or alter production PostgreSQL,
  AWS resources, IAM, S3, secrets or policies. Release approval remains #646.

## Release / rollback

Only the application image and CI test code are affected. No migrations,
new resource or runtime call site is introduced. A normal prior-image rollback
restores the previous code; it must **never** be used to claim that the
independent erasure ledger or persistent quarantine is operational.

Execution of the real restore flow requires:

1. Signed, complete, independently pinned ledger and run ID (#694).
2. Cross-service independent quarantine and ingress/egress gates (#728/#734).
3. DB replay under owner lock with full timestamp fidelity (#729).
4. All-copy purge, verification and isolated old-backup restore test (#730).
5. Separate approval / operator runbook and consent tests (#646/#518).
