# Daily Bonus β

Daily Bonus is a dedicated default-disabled Bot Plugin. It does not weaken Daily Content's mention prohibition. Enable only after the canonical wallet, verified existing identity/account and account/journal agreement and privacy publication have been accepted.

## Ownership and configuration

Web owns the one JST daily receipt, reward rule and canonical ledger. Herta records delivery status and a minimal copy of a confirmed receipt, never a separate balance. Web/member and Discord claims use the same canonical transaction and uniqueness constraint. The public Discord button opens a private four-choice quiz when an approved daily question exists. Wrong answers still earn the base draw; no approved question gives a draw-only receipt. Question bank, JSON import and reward probability/ranges are administered in Web Admin.

Studio Plugin Manager/Config Studio manages enabled state, destination channel, notification/eligible role, fixed09:00 Asia/Tokyo schedule, categories/max3, template and private fortune display. Guild ID comes from the managed Guild and must match the configured Web integration Guild. Do not hardcode a guessed Guild/channel. Global `DAILY_BONUS_ENABLED=true` is additionally required; absent by default. Bot needs the scoped `HERTA_POINTS_SECRET`, existing API base URL and integration Guild. Studio fortune read reuses a purpose-derived `IVRM_INTEGRATION_TOKEN`; never expose keys in browsers.

Studio `/dashboard/guilds/{guildId}/daily-bonus` shows delivery statuses, claim counts and source-reviewed anniversary editor. Configure a dedicated role and verify it exists, is mentionable or the Bot has mention permission, plus channel View/Send/Embed/History permissions. Only that role is allowed in `allowedMentions`; body mentions do not execute. Role deletion fails preflight and is recorded as failed. Member notification preferences are respected by Discord.

## Delivery recovery

Guild/date reservation prevents parallel Bots creating another occurrence. A late startup only creates today's occurrence, never a backlog. Known pre-send failures are retryable from Studio only for the current day and only while no message ID exists. Any ambiguous Discord send remains `uncertain` and is never automatically resent. Studio's reconcile action requests the Bot to inspect the most recent100 messages for exactly one own-Bot message matching date, role and bonus button; one exact match is adopted, otherwise operator review remains necessary. Do not infer message absence from a bounded search or reset uncertain rows to retryable.

Each private answer button references a persisted random quiz session bound to Guild, user, date, original public announcement and quiz. Fresh role membership and original message existence are rechecked before claim; ephemeral message IDs are not mistaken for the announcement. Web independently enforces date/window, subject, answer and canonical daily uniqueness. Lost responses may be retried without another award. Credit confirms before fortune retrieval/rendering; fortune errors never reverse points.

## Fortune privacy and retention

The existing fortune algorithm supplies daily results. When enabled, the first result is saved under Guild/user/date with version; both `/fortune today` and bonus use it. Profile-derived `details` are neutralized and raw-profile hint notes are excluded before storage. History API explicitly projects only result fields and cannot return added profile fields. Results/confirmed Herta receipts retain180days; private quiz sessions retain1day. Worker hourly cleanup runs independently of announcement generation. Pending/unconfirmed claims are retained for reconciliation up to180days from last update, then removed locally; the canonical ledger remains unchanged. `/herta-privacy export` includes personal results/receipts; `/fortune forget` deletes the current Guild's personal fortune history.

Signed read contract: `contracts/ivrm/herta-daily-fortunes-read.v1.json`; producer Herta Studio, consumer ivrm-web server. Web must resolve Member subject from session, and Admin reads require explicit authorization. No birthday/blood type/MBTI or derived age/zodiac/eto is returned. Entertainment disclaimer accompanies results. Publish Web official privacy changes with Herta policy before enabling.

## Release and rollback

Merge: contract freeze→compatible Web shared claim/quiz API→Herta→Member/Admin consumers. Deploy schema expand first, disabled API/consumer next, validated Guild configuration and canonical account/journal reconciliation, then enable. Herta runtime merges automatically deploy/migrate: review exact HEAD, backup/restore and target-specific production approval before merge. Do not use Platform to deploy production.

Rehearse new migration and restores on isolated synthetic PostgreSQL. Keep old immutable image and additive schema. Disable the Plugin/global flag to stop new deliveries/claims. After canonical credit, retain ledger/receipt and reconcile or roll forward; never delete receipt or switch to an old wallet. A timeout is not proof a credit/send failed. Production acceptance must verify one09:00 announcement, correct role, private quiz/fortune, same wallet balances/history and unauthorized denial.

## Remaining acceptance gates

This document is a runbook candidate, not evidence production rollout occurred. Full CI/build/negative tests, actual limited-Guild Discord acceptance, live backup/canonical-account/secret validation and signed Member/Admin history acceptance remain release gates until recorded in the owning PR.

Operator-selected target: Guild964326043420872704, channel1042774690227306517 (┣⚙｜system通知), role1565130164386398403 (herta.notice),09:00Asia/Tokyo. Apply only after the reviewed release gate; no live configuration has been changed by this document. Daily-only release does not enable or import legacy activity accrual (COMMON_POINTS_ENABLED staysfalse).

### β運用指標の制限

配信直前に既存GuildMembers Intentで全メンバーを取得し、通知ロールを持つBot以外の人数と取得日時のみを保存します。個人一覧は保存しません。全件取得は10秒で打ち切り、失敗時の人数・率は取得不可とします（キャッシュで補完せず、配信は継続）。安全な再試行時は新しい対象ロールで再取得します。参考受取率はHertaがDiscord操作で確認した確定件数÷配信時対象人数です。ポータルのみの受取や配信後のロール変更により正確な同一集団のCanonical受取率ではなく、100%を超える場合も補正しません。0人時は率を算出しません。
