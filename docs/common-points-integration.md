# Common wallet integration preparation

Parent ivrm-platform#103; reuse Herta#538. Herta#537/PR540 solved top25 statistics
coverage only. Current Community Points is current-rate activity calculation,
not a wallet. Season Points, XP, badges and titles remain independent.

`@herta/shared/common-points` provides an opt-in, server-only signed client for
Web's points v1. It pins api.ivrm.jp, guild scope,5s timeout, no-store and refuses
redirects. Unknown/unavailable/malformed results return null, never local-score
fallback. Signing uses a separate points key. Sender retries must preserve
durable body/event ID and refresh only timestamp. Client code alone does **not**
create an outbox, schedule sends or change Bot/Studio display.

Verified locally: shared typecheck/build +3 client tests; real compiled Herta
client→Web API handler→isolated PostgreSQL17, Herta/member/admin balances all160
and ledger SUM160 after parallel earn/adjust/claim/spend/refund/replay tests.
No production data, deploy, Secret or DB migration was used.

## Mandatory next implementation (release blockers)

- Atomically persist stable earning + outbox alongside each owner activity write,
  including messages/reactions/commands/polls and session VC/online/game paths,
  plus Studio/Bot achievement unlock. LFG/TeamSplit emitters are in top-level
  `plugins/lfg` and `plugins/team-split`; move accrual into their owner transactions
  instead of relying on the current post-commit metric callbacks.
- Freeze rate/version and preserve per-JST-day floor/cap semantics. Compute
  nonnegative incremental entitlement against a locked watermark; tariff edits
  cannot revalue already granted history. Session contributions across migration
  T must be split/settled. Epoch and source event identities remain stable.
- Durable bounded worker: lease/ack/retry/backoff, samebody/sameevent after timeout,
  retain unresolved409 and poison payloads for operator review, maxattempt/age
  alert, no fire-and-forget. Source mutation/outbox rollback together.
- Bot/Studio common-point display reads canonical wallet for an authorized guild/
  Discord subject, handles pending/unavailable explicitly; preserve separately
  labeled activity ranking and season metrics. No private key in browser props.
- Actual frozen snapshot and verified Discord→users.id mapping, evidence-based
  dedup, idempotent opening import/enrollment and cross-product browser E2E.

Contract producer/consumer inspected on main f5076e1/47cdc24. Merge order:
contracts → disabled Web receiver → Herta client/outbox/UI. Deploy/Secret/schema/
opening import are separately approved, after backup/restore and rehearsal.
Existing activity-v1 remains unchanged. Never feed its cumulative randomUUID
snapshots to earn API. Rollback after new writes requires sender quiesce and
receipt/outbox reconciliation; do not URL-switch to stale balances.
