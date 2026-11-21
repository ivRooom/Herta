# Daily Bonus β

Daily Bonus is a dedicated default-disabled Bot Plugin. It does not weaken Daily Content's mention prohibition. Enable only after the canonical wallet, verified existing identity/account and account/journal agreement and privacy publication have been accepted.

## Ownership and configuration

Web owns the one JST daily receipt, reward rule and canonical ledger. Herta records delivery status and a minimal copy of a confirmed receipt, never a separate balance. Web/member and Discord claims use the same canonical transaction and uniqueness constraint. The public Discord button opens a private four-choice quiz when an approved daily question exists. Wrong answers still earn the base draw; no approved question gives a draw-only receipt. Question bank, JSON import and reward probability/ranges are administered in Web Admin.

Studio Plugin Manager/Config Studio manages enabled state, destination channel, notification/eligible role, fixed09:00 Asia/Tokyo schedule, categories/max3, template and private fortune display. Guild ID comes from the managed Guild and must match the configured Web integration Guild. Do not hardcode a guessed Guild/channel. Global `DAILY_BONUS_ENABLED=true` is additionally required; absent by default. Bot needs the scoped `HERTA_POINTS_SECRET`, existing API base URL and integration Guild. Studio fortune read reuses a purpose-derived `IVRM_INTEGRATION_TOKEN`; never expose keys in browsers.

Studio `/dashboard/guilds/{guildId}/daily-bonus` shows delivery statuses and claim counts. The anniversary bank is owned by ivrm-web Today-in-History (see `docs/TODAY_HISTORY_MIGRATION_ADR.md`): the Bot fetches the day's confirmed selection from the Web API at send time and never reads a local anniversary table.

Special-day overrides (#705) live in `daily_special_day_rules`: a rule scoped to the Guild pins an exact JST date or an annual month-day and replaces the announcement title and/or the intro line (the messageTemplate position) for that day. Resolution is date rule over annual rule, disabled rules never fire, and any read failure degrades to the standard announcement. The banner image and theme come from the Web daily bundle (#1304), never from these rules. Studio rule management and a no-send preview are a later slice; until then rules change only through reviewed SQL. Configure a dedicated role and verify it exists, is mentionable or the Bot has mention permission, plus channel View/Send/Embed/History permissions. Only that role is allowed in `allowedMentions`; body mentions do not execute. Role deletion fails preflight and is recorded as failed. Member notification preferences are respected by Discord.

Message-template revisions (#766 Phase C) live in `daily_bonus_template_revisions`: the base announcement body moves draft -> pending_review -> approved -> active -> superseded (pending_review -> rejected when returned), the author can never approve their own revision, and activation is a compare-and-swap on the currently active revision with at most one active revision per Guild. At send time the Bot prefers a special-day intro, then the active revision, then the plugin config `messageTemplate`, and records the revision id used on `daily_bonus_announcements.template_revision_id` as the delivery snapshot. Any read failure degrades to the config template. Studio manages revisions and a no-send preview on the same daily-bonus page.

TEST sends (#766 Phase D1 / #723) are queued in `daily_bonus_test_sends` from the Studio Composer page: the Bot claims a queued request, validates the target channel itself, and sends exactly one TEST-marked message composed like the production announcement (the today-history fetch uses preview mode, so a test never freezes the day's snapshot). Test sends never ping the role (`allowedMentions` parse is empty), never use the production nonce or `daily_bonus_announcements`, and their buttons use inert `daily-bonus-test:` customIds that only answer with an explanation. A guild may have one in-flight request at a time, requests are at least 60 seconds apart and expire after 10 minutes, and an unknown delivery outcome is recorded as `uncertain` and never resent.

Configurable send time (#766 Phase D2, plan B): the plugin setting `scheduleTime` (HH:MM, 09:00-23:59 JST) controls only when the announcement message is sent. The slot itself stays anchored at 09:00: the calendar date, the claim window, and the receive deadline shown in the embed never move, so claims can open on the member portal before the Discord announcement goes out. Invalid values fall back to 09:00.

Quest view button (#954): the announcement carries a fifth button, `daily-bonus:quests:<date>`, and a quest board link line in the description. Pressing the button answers only the presser (ephemeral) with their own quest board - the same fetch, image card, and period switcher as the /quest command (#946), starting on the daily period. It is read-only: it never claims, answers, or moves points. The TEST row mirrors the button with an inert `daily-bonus-test:` id.

Bundle video (#766 Phase D3, ivrm-web #1500): bundle contract v2 adds an optional video URL, resolved like the image (date > annual > default) and managed in the Web Admin calendar. Delivery is by link: the announcement message content is the role mention plus the video URL on its own line, and Discord renders the direct video link inline; the bot never downloads or attaches the file. TEST sends carry the bare URL as their content. A malformed video degrades on its own (the image and theme still render), and the delivery-recovery matcher accepts both the plain mention and the mention + video line shapes. Contract v1 bundles (no video) keep working unchanged.

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
