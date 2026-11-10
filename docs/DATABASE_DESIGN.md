# Herta DB 設計書（ER図・テーブル定義・CRUD）v1.0

- 文書ID: DOC-HERTA-DB-001
- 版: v1.0.0
- 状態: Current（生成物。配置先 repo は Phase 4 で決定）
- 生成元: `ivRooom/Herta` の `packages/db/prisma/schema.prisma`（main `bd6cbabb`、ファイル SHA `0eb4ef72`、1,580行）を 2026-11-10 に全文取得して生成。手書き転記ではなく schema からの機械的抽出を基に編集
- 最終更新 / Last Reviewed: 2026-11-10 / 承認者: 未（Phase 4 で repo 配置時に承認）

## 現在の状態

- Prisma model **80件**（全て @@map でテーブル名を明示）、フィールド総数 **821件**、enum **1件**（VcRecapSessionStatus）。
- 実 DB（PG17 `herta`）は復元検証で **101テーブル**が確認されている。schema の80との差分21は `_prisma_migrations` 等の管理テーブルと、schema から削除済みの旧テーブルの残存が候補だが、**内訳は未検証**（実 DB のテーブル一覧との突合が次の照合タスク）。
- 明示 `@relation`（実 FK）を持つ model は30件のみ。残りは guildId / userId 等のスカラー列による**論理参照**で、DB レベルの FK 制約は無い。ER図では実 FK を実線、論理参照は本書では省略し各テーブルの備考で扱う。
- 状態系フィールドは enum 化が VcRecapSession のみで、他は全て String＋既定値で表現されている。

## ER図（主要リレーションのみ、実 FK）

```mermaid
erDiagram
  guilds ||--o{ guild_members : "所属"
  users ||--o{ guild_members : "所属"
  guilds ||--o{ roles : "保持"
  guild_members ||--o{ user_roles : "割当"
  roles ||--o{ user_roles : "割当"
  guilds ||--o{ guild_plugins : "導入"
  plugins ||--o{ guild_plugins : "導入"
  guild_plugins ||--o{ guild_plugin_config_history : "履歴"
  guilds ||--o{ rules : "保持"
  rules ||--o{ rule_execution_logs : "実行"
  guilds ||--|| guild_settings : "設定"
  guilds ||--o{ audit_logs : "記録"
  guilds ||--o{ moderation_detection_events : "検出"
  auto_responses ||--o{ auto_response_execution_events : "実行"
  lfg_posts ||--o{ lfg_participants : "参加"
  team_split_sessions ||--o{ team_split_participants : "参加"
  daily_contents ||--o{ daily_content_deliveries : "配信"
  community_events ||--o{ event_rsvps : "申込"
  community_season_snapshots ||--o{ community_season_snapshot_entries : "明細"
  studio_access_groups ||--o{ studio_access_group_members : "所属"
  studio_access_policies ||--o{ studio_access_policy_attachments : "付属"
  vc_recap_sessions ||--o{ vc_recap_transcript_segments : "発話"
  guilds ||--o{ vc_recap_sessions : "開催"
  guilds ||--o{ daily_bonus_claims : "受取"
  guilds ||--o{ daily_fortune_results : "結果"
  guilds ||--o{ valorant_pick_sessions : "開催"
  valorant_pick_sessions ||--o{ valorant_pick_participants : "参加"
  valorant_pick_sessions ||--o| valorant_match_results : "結果"
  valorant_rosters ||--o{ valorant_agents : "構成"
```

## テーブル一覧（80件）

| テーブル                          | model                         | フィールド数 | 領域           |
| --------------------------------- | ----------------------------- | ------------ | -------------- |
| guilds                            | Guild                         | 28           | コア           |
| users                             | User                          | 11           | コア           |
| guild_members                     | GuildMember                   | 8            | コア           |
| roles                             | Role                          | 9            | コア           |
| user_roles                        | UserRole                      | 7            | コア           |
| guild_settings                    | GuildSettings                 | 10           | コア           |
| audit_logs                        | AuditLog                      | 14           | コア           |
| birthday_card_backgrounds         | BirthdayCardBackground        | 12           | Daily/誕生日   |
| birthday_card_assets              | BirthdayCardAsset             | 15           | Daily/誕生日   |
| valorant_rosters                  | ValorantRoster                | 4            | Valorant       |
| valorant_agents                   | ValorantAgent                 | 8            | Valorant       |
| command_execution_events          | CommandExecutionEvent         | 8            | 分析イベント   |
| ai_generation_events              | AiGenerationEvent             | 14           | AI             |
| ai_guild_monthly_budget_usage     | AiGuildMonthlyBudgetUsage     | 3            | AI             |
| ai_user_model_preferences         | AiUserModelPreference         | 5            | AI             |
| mbti_quiz_result_events           | MbtiQuizResultEvent           | 9            | MBTI           |
| mbti_question_answer_events       | MbtiQuestionAnswerEvent       | 7            | MBTI           |
| mbti_web_quiz_sessions            | MbtiWebQuizSession            | 13           | MBTI           |
| mbti_personal_results             | MbtiPersonalResult            | 12           | MBTI           |
| mbti_result_access                | MbtiResultAccess              | 4            | MBTI           |
| plugins                           | Plugin                        | 10           | プラグイン     |
| guild_plugins                     | GuildPlugin                   | 10           | プラグイン     |
| guild_plugin_config_history       | GuildPluginConfigHistory      | 9            | プラグイン     |
| rules                             | Rule                          | 19           | ルール         |
| rule_execution_logs               | RuleExecutionLog              | 10           | ルール         |
| service_health_snapshots          | ServiceHealthSnapshot         | 15           | 運用           |
| community_activity_daily          | CommunityActivityDaily        | 6            | コミュニティ   |
| community_voice_sessions          | CommunityVoiceSession         | 5            | コミュニティ   |
| community_activity_channel_daily  | CommunityActivityChannelDaily | 7            | コミュニティ   |
| community_presence_sessions       | CommunityPresenceSession      | 4            | コミュニティ   |
| community_game_sessions           | CommunityGameSession          | 5            | コミュニティ   |
| community_game_activity_daily     | CommunityGameActivityDaily    | 6            | コミュニティ   |
| achievement_unlocks               | AchievementUnlock             | 4            | コミュニティ   |
| community_profile_preferences     | CommunityProfilePreference    | 6            | コミュニティ   |
| community_challenge_assignments   | CommunityChallengeAssignment  | 5            | コミュニティ   |
| community_challenge_completions   | CommunityChallengeCompletion  | 8            | コミュニティ   |
| community_season_snapshots        | CommunitySeasonSnapshot       | 9            | コミュニティ   |
| community_season_snapshot_entries | CommunitySeasonSnapshotEntry  | 7            | コミュニティ   |
| auto_responses                    | AutoResponse                  | 22           | モデレーション |
| auto_response_execution_events    | AutoResponseExecutionEvent    | 8            | モデレーション |
| mod_actions                       | ModAction                     | 10           | モデレーション |
| word_filters                      | WordFilter                    | 14           | モデレーション |
| spam_settings                     | SpamSettings                  | 9            | モデレーション |
| moderation_settings               | ModerationSettings            | 10           | モデレーション |
| moderation_detection_events       | ModerationDetectionEvent      | 20           | モデレーション |
| moderation_blacklist_entries      | ModerationBlacklistEntry      | 8            | モデレーション |
| quotes                            | Quote                         | 16           | コンテンツ     |
| lfg_posts                         | LfgPost                       | 23           | コンテンツ     |
| lfg_participants                  | LfgParticipant                | 8            | コンテンツ     |
| team_split_sessions               | TeamSplitSession              | 27           | コンテンツ     |
| team_split_participants           | TeamSplitParticipant          | 9            | コンテンツ     |
| daily_contents                    | DailyContent                  | 23           | コンテンツ     |
| daily_content_deliveries          | DailyContentDelivery          | 18           | コンテンツ     |
| community_events                  | CommunityEvent                | 22           | コンテンツ     |
| event_rsvps                       | EventRsvp                     | 6            | コンテンツ     |
| studio_user_preferences           | StudioUserPreference          | 4            | Studio         |
| bot_presence_settings             | BotPresenceSetting            | 6            | Studio/運用    |
| studio_access_policies            | StudioAccessPolicy            | 11           | Studio         |
| studio_access_groups              | StudioAccessGroup             | 9            | Studio         |
| studio_access_group_members       | StudioAccessGroupMember       | 6            | Studio         |
| studio_access_policy_attachments  | StudioAccessPolicyAttachment  | 8            | Studio         |
| runtime_secrets                   | RuntimeSecret                 | 8            | 運用           |
| valorant_account_links            | ValorantAccountLink           | 7            | Valorant       |
| member_activity_events            | MemberActivityEvent           | 10           | 分析イベント   |
| fortune_profiles                  | FortuneProfile                | 10           | Daily/占い     |
| user_data_consents                | UserDataConsent               | 4            | 同意/VC Recap  |
| vc_recap_explicit_consents        | VcRecapExplicitConsent        | 6            | 同意/VC Recap  |
| vc_recap_erasure_requests         | VcRecapErasureRequest         | 4            | 同意/VC Recap  |
| vc_recap_storage_objects          | VcRecapStorageObject          | 11           | VC Recap       |
| voice_consent_access              | VoiceConsentAccess            | 3            | 同意/VC Recap  |
| vc_recap_sessions                 | VcRecapSession                | 14           | VC Recap       |
| vc_recap_transcript_segments      | VcRecapTranscriptSegment      | 8            | VC Recap       |
| daily_bonus_announcements         | DailyBonusAnnouncement        | 12           | Daily          |
| daily_bonus_claims                | DailyBonusClaim               | 8            | Daily          |
| anniversary_events                | DailyAnniversaryEvent         | 19           | Daily          |
| daily_bonus_quiz_sessions         | DailyBonusQuizSession         | 8            | Daily          |
| daily_fortune_results             | DailyFortuneResult            | 7            | Daily          |
| valorant_pick_sessions            | ValorantPickSession           | 21           | Valorant       |
| valorant_pick_participants        | ValorantPickParticipant       | 4            | Valorant       |
| valorant_match_results            | ValorantMatchResult           | 14           | Valorant       |

enum: `VcRecapSessionStatus` = active / summarizing / completed / failed（VcRecapSession.status、既定 active）

## テーブル定義（全80件、フィールド詳細）

表記: `列名: 型`、PK=主キー、UQ=ユニーク、FK=実リレーション（参照先と削除時挙動）。型は Prisma 型（String/Int/BigInt/Float/Boolean/DateTime/Json/Bytes/String[]/Int[]）。`?` は NULL 可。既定値があるものは主なもののみ括弧書き。

### コア

- **guilds** (Guild): id: String PK / name / icon? / ownerId? / plan (既定 "free") / locale ("ja") / timezone ("Asia/Tokyo") / features: Json ("[]") / createdAt (now) / updatedAt
- **users** (User): id PK / username / discriminator? / avatar? / email? / locale? / isAdmin (false) / createdAt / updatedAt
- **guild_members** (GuildMember): PK=(guildId, userId) / nickname? / joinedAt? / roles: String[] / FK guild→guilds (Cascade), user→users (Cascade)
- **roles** (Role): id PK (uuid) / guildId FK→guilds (Cascade) / name / permissions: String[] / isDefault (false) / position (0) / createdAt
- **user_roles** (UserRole): PK=(guildId, userId, roleId) / assignedBy? / assignedAt (now) / FK member→guild_members (Cascade), role→roles (Cascade)
- **guild_settings** (GuildSettings): guildId PK・FK→guilds (Cascade) / prefix ("!") / logChannelId? / modRoleIds: String[] / adminRoleIds: String[] / locale ("ja") / settingsJson: Json ("{}") / version (1) / updatedAt
- **audit_logs** (AuditLog): id PK (uuid) / guildId FK→guilds (Cascade) / actorId / actorType ("user") / event / targetType? / targetId? / changes: Json? / metadata: Json? / severity ("info") / ipAddress? / sessionId? / createdAt

### プラグイン / ルール

- **plugins** (Plugin): id PK / name / description? / version / author? / category? / isOfficial (false) / manifest: Json / createdAt
- **guild_plugins** (GuildPlugin): PK=(guildId, pluginId) / enabled (true) / config: Json ("{}") / configVersion (1) / installedAt / updatedAt / FK guild→guilds (Cascade), plugin→plugins
- **guild_plugin_config_history**: id PK (uuid) / guildId / pluginId / version / config: Json / changedBy / changeReason? / createdAt / FK→guild_plugins (Cascade)
- **rules** (Rule): id PK (uuid) / guildId FK→guilds (Cascade) / pluginId? / name / description? / enabled (true) / priority (0) / schemaVersion (1) / trigger: Json / conditions: Json ("[]") / actions: Json ("[]") / cooldownMs (0) / maxExecutions? / executionCount (0) / createdBy / createdAt / updatedAt
- **rule_execution_logs**: id PK (uuid) / ruleId FK→rules (Cascade) / guildId / triggerEvent: Json / conditionsMet: Boolean / actionsResult: Json? / error? / durationMs? / executedAt

### モデレーション

- **auto_responses**: id PK (uuid) / guildId / name / triggerType / triggerValue / matchMode ("partial") / responseType ("text") / responseContent / channelIds: String[] / roleIds: String[] / cooldownSeconds (0) / priority (0) / caseSensitive (false) / responseCount (0) / failureCount (0) / lastTriggeredAt? / enabled (true) / createdBy? / updatedBy? / createdAt / updatedAt
- **auto_response_execution_events**: id PK (uuid) / guildId / ruleId FK→auto_responses (Cascade) / status / durationMs / errorName? / executedAt
- **mod_actions**: id PK (uuid) / guildId / targetId / moderatorId / actionType / reason? / durationMs: BigInt? / expiresAt? / active (true) / createdAt
- **word_filters**: id PK (uuid) / guildId / pattern / patternType ("exact") / action ("delete") / reason? / caseSensitive (false) / exemptRoles: String[] / exemptChannels: String[] / enabled (true) / createdBy? / updatedBy? / createdAt / updatedAt
- **spam_settings**: guildId PK / maxMessages (5) / timeWindowMs (5000) / maxMentions (10) / maxLinks (3) / duplicateThreshold (3) / action ("timeout") / timeoutDurationMs: BigInt (300000) / enabled (true)
- **moderation_settings**: guildId PK / enableWordFilter (true) / enableInviteFilter (false) / enableSpamFilter (true) / logChannelId? / exemptRoles / exemptChannels / allowedInvites: String[] / inviteAction ("delete") / updatedAt
- **moderation_detection_events**: id PK (uuid) / guildId FK→guilds (Cascade) / messageId / channelId / userId / detectionKind / mode ("observe") / messageLength / observedCount? / threshold? / ruleIndex? / idempotencyKey UQ / reviewStatus ("unreviewed") / reviewedBy? / reviewedAt? / reviewNote? / occurredAt / createdAt / updatedAt
- **moderation_blacklist_entries**: PK=(guildId, userId) / reason? / originDetectionId? / createdBy / active (true) / createdAt / updatedAt

### コミュニティ活動

- **community_activity_daily**: PK=(guildId, userId, activityDate, metric) / value: BigInt (0) / updatedAt
- **community_voice_sessions**: PK=(guildId, userId) / channelId / startedAt / updatedAt
- **community_activity_channel_daily**: PK=(guildId, channelId, userId, activityDate, metric) / value: BigInt (0) / updatedAt
- **community_presence_sessions**: PK=(guildId, userId) / startedAt / updatedAt
- **community_game_sessions**: PK=(guildId, userId) / activityName / startedAt / updatedAt
- **community_game_activity_daily**: PK=(guildId, userId, activityName, activityDate) / value: BigInt (0) / updatedAt
- **achievement_unlocks**: PK=(guildId, userId, achievementId) / unlockedAt
- **community_profile_preferences**: PK=(guildId, userId) / isPublic (true) / featuredAchievementIds: String[] / titleAchievementId? / updatedAt
- **community_challenge_assignments**: PK=(guildId, periodType, periodKey) / challengeIds: String[] / createdAt
- **community_challenge_completions**: PK=(guildId, userId, challengeId, periodType, periodKey) / seasonKey / points / completedAt
- **community_season_snapshots**: PK=(guildId, seasonKey) / seasonIndex / startsAt / endsAt / participantCount (0) / sourceVersion (1) / finalizedAt
- **community_season_snapshot_entries**: PK=(guildId, seasonKey, userId)、UQ=(guildId, seasonKey, rank) / rank / points / awardTier? / FK→community_season_snapshots (Cascade)

### コンテンツ / イベント

- **quotes**: id PK (uuid) / guildId / quoteNumber、UQ=(guildId, quoteNumber) / quoteText / sourceMessageId? / sourceChannelId? / sourceMessageUrl? / sourceAuthorId? / sourceAuthorName? / registeredById / registeredByName / tags: String[] / status ("public") / isNsfw (false) / createdAt / updatedAt
- **lfg_posts**: id PK (uuid) / guildId / creatorId / channelId / messageId? / game / title / description ("") / maxPlayers (5) / participantCount (1) / startTime? / expiresAt / status ("open") / messageState ("pending") / lastErrorName? / closedAt? / createdBy? / updatedBy? / deletedAt? / version (1) / createdAt / updatedAt
- **lfg_participants**: PK=(lfgId, userId) / guildId / status ("joined") / joinedAt / leftAt? / updatedAt / FK→lfg_posts (Cascade)
- **team_split_sessions**: id PK (uuid) / guildId / creatorId / channelId / messageId? / title ("Team Split") / teamCount (2) / mode ("random") / maxParticipants (20) / participantCount (0) / participants: String[] / teams: Json? / seedHash ("") / generation (0) / status ("open") / expiresAt / splitAt? / closedAt? / messageState ("pending") / lastErrorName? / createdBy? / updatedBy? / deletedAt? / version (1) / createdAt / updatedAt
- **team_split_participants**: PK=(sessionId, userId) / guildId / score (0) / status ("joined") / joinedAt / leftAt? / updatedAt / FK→team_split_sessions (Cascade)
- **daily_contents**: id PK (uuid) / guildId / channelId / title ("") / content / scheduleTime / timezone ("Asia/Tokyo") / enabled (true) / recurrenceType ("daily") / onceAt? / weekdays: Int[] / messageFormat ("text") / embedJson: Json? / publishAnnouncement (false) / nextRunAt? / lastScheduledAt? / lastSentAt? / deletedAt? / createdBy? / updatedBy? / createdAt / updatedAt
- **daily_content_deliveries**: id PK (uuid) / dailyContentId FK→daily_contents (Restrict) / guildId / idempotencyKey UQ / origin ("scheduled") / scheduledFor / status ("pending") / attemptCount (0) / messageId? / errorName? / queuedAt? / startedAt? / nextAttemptAt? / sentAt? / failedAt? / createdAt / updatedAt
- **community_events**: id PK (uuid) / guildId / creatorId / channelId / messageId? / title / description? / location? / timezone ("Asia/Tokyo") / startsAt / registrationClosesAt / capacity? / status ("open") / allowMaybe (true) / allowWaitlist (true) / reminderMinutes (60) / reminderSentAt? / reminderClaimedAt? / finalizedAt? / createdAt / updatedAt
- **event_rsvps**: PK=(eventId, userId) / status / createdAt / updatedAt / FK→community_events (Cascade)

### MBTI / AI / 分析イベント

- **mbti_quiz_result_events**: id PK / completionId / guildId / resultType / eiScore / snScore / tfScore / jpScore / completedAt
- **mbti_question_answer_events**: id PK / completionId / guildId / questionIndex / axis / answer / answeredAt
- **mbti_web_quiz_sessions**: id PK (uuid) / guildId / discordUserId / status ("pending") / questionOrder: Json / answers: Json ("[]") / scores: Json ("{}") / resultType? / resultIdentity? / completedAt? / expiresAt / createdAt / updatedAt
- **mbti_personal_results**: id PK (uuid) / completionKey UQ / guildId / discordUserId / resultType / resultIdentity / scores: Json / percentages: Json / questionCount / scoringVersion / source / completedAt
- **mbti_result_access**: PK=(guildId, discordUserId) / tokenHash UQ / expiresAt
- **ai_generation_events**: id PK / guildId / provider / model / modelProfile / feature / resultCategory / errorCategory? / inputTokens / outputTokens / totalTokens / estimatedCostUsd: Float / durationMs / occurredAt
- **ai_guild_monthly_budget_usage**: PK=(guildId, periodStart) / reservedMicroUsd: BigInt (0)
- **ai_user_model_preferences**: PK=(guildId, userId) / provider / modelProfile / updatedAt
- **command_execution_events**: id PK / guildId? / userId? / commandName / status / durationMs / errorName? / executedAt
- **member_activity_events**: id PK (uuid) / guildId / userId? / event / channelId? / messageId? / content? / contentScrubbedAt? / metadata: Json? / occurredAt
- **service_health_snapshots**: id PK (uuid) / serviceId / version / status / discordStatus / databaseStatus / redisStatus / workerStatus / databaseLatencyMs? / redisLatencyMs? / workerLatencyMs? / guildCount (0) / uptimeSeconds (0) / checkedAt / createdAt

### Studio / アクセス / 運用

- **studio_user_preferences**: userId PK・FK→users (Cascade) / defaultGuildId? / updatedAt
- **bot_presence_settings**: id PK ("default") / status ("online") / activityType ("playing") / activityText ("Herta") / updatedBy? / updatedAt
- **studio_access_policies**: id PK / guildId / name、UQ=(guildId, name)・(id, guildId) / description? / document: Json / revision (1) / createdBy / updatedBy / createdAt / updatedAt
- **studio_access_groups**: id PK / guildId / name、UQ=(guildId, name)・(id, guildId) / description? / createdBy / updatedBy / createdAt / updatedAt
- **studio_access_group_members**: PK=(groupId, userId) / guildId / createdBy / createdAt / FK→studio_access_groups (Cascade)
- **studio_access_policy_attachments**: id PK / policyId / guildId / principalType / principalId、UQ=(policyId, principalType, principalId) / createdBy / createdAt / FK→studio_access_policies (Cascade)
- **runtime_secrets**: name PK / ciphertext: Bytes / iv: Bytes / authTag: Bytes / keyVersion (1) / updatedBy / createdAt / updatedAt（値は暗号化保管。本文書に実値は書かない）

### 同意 / VC Recap

- **user_data_consents**: userId PK / voiceTranscriptionConsent (false) / voiceTranscriptRetentionConsentedAt? / updatedAt
- **vc_recap_explicit_consents**: PK=(userId, purpose) / policyVersion / consentedAt? / revokedAt? / updatedAt
- **vc_recap_erasure_requests**: userId PK / requestedAt / storageDeletionVerifiedAt? / updatedAt
- **vc_recap_storage_objects**: id PK (uuid) / userId / sessionId? / kind / bucket / objectKey、UQ=(bucket, objectKey) / versionId? / state ("reserved") / createdAt / committedAt? / updatedAt
- **voice_consent_access**: userId PK / tokenHash UQ / expiresAt
- **vc_recap_sessions**: id PK (uuid) / guildId FK→guilds (Cascade) / channelId / startedBy? / status: VcRecapSessionStatus (active) / consentingUserIds: String[] / nonConsentingUserIds: String[] / summary? / topics: String[] / startedAt / endedAt? / createdAt
- **vc_recap_transcript_segments**: id PK (uuid) / sessionId FK→vc_recap_sessions (Cascade) / userId / text / startedAt / endedAt / createdAt

### Daily / 占い / 誕生日

- **birthday_card_backgrounds**: guildId PK・FK→guilds (Cascade) / contentType / fileName / content: Bytes / sizeBytes / width / height / sha256 / updatedBy / createdAt / updatedAt
- **birthday_card_assets**: id PK / guildId FK→guilds (Cascade) / name / contentType / content: Bytes / sizeBytes / width / height / sha256 / isPreset (false) / createdBy / updatedBy / createdAt / updatedAt
- **fortune_profiles**: PK=(guildId, userId) / birthday? / bloodType? / mbti? / zodiac? / ageGroup? / eto? / updatedAt / FK→guilds (Cascade)
- **daily_bonus_announcements**: PK=(guildId, targetDate) / eligibleCount? / eligibleCapturedAt? / channelId / roleId / status ("pending") / messageId? / errorCode? / createdAt / updatedAt / FK→guilds (Cascade)
- **daily_bonus_claims**: PK=(guildId, discordUserId, targetDate) / status / receiptJson: Json? / createdAt / updatedAt / FK→guilds (Cascade)
- **anniversary_events**: id PK / guildId FK→guilds (Cascade) / title / summary ("") / category / month / day / baseYear? / workName ("") / characterName ("") / sourceUrl / sourceCheckedAt / approved (false) / public (false) / priority (0) / pinnedDate? / anniversaryMode ("annual") / updatedAt
- **daily_bonus_quiz_sessions**: id PK / guildId FK→guilds (Cascade) / discordUserId / targetDate / announcementMessageId / quizId / createdAt
- **daily_fortune_results**: PK=(guildId, discordUserId, targetDate) / algorithmVersion / resultJson: Json / createdAt / FK→guilds (Cascade)

### Valorant

- **valorant_rosters**: guildId PK・FK→guilds (Cascade) / createdAt
- **valorant_agents**: PK=(guildId, agentId)、UQ=(guildId, agentName) / agentName / displayName / enabled (true) / createdAt / updatedAt / FK→valorant_rosters (Cascade)
- **valorant_account_links**: PK=(guildId, userId) / riotName / riotTag / region / linkedAt / updatedAt
- **valorant_pick_sessions**: id PK (uuid)、UQ=(id, guildId) / guildId FK→guilds (Cascade) / channelId / messageId? UQ / creatorId / status ("OPEN") / mode / mapId? / voiceChannelId? / optedOutUserIds: String[] / maxParticipants (5) / expiresAt / completedAt? / rulesVersion / candidates: Json ("[]") / result: Json? / createdAt / updatedAt
- **valorant_pick_participants**: PK=(sessionId, userId) / joinedAt / FK→valorant_pick_sessions (Cascade)
- **valorant_match_results**: id PK (uuid) / sessionId UQ / guildId / mapId / matchId?、UQ=(guildId, matchId) / source ("MANUAL") / outcome / roundsWon / roundsLost / playerResults: Json ("[]") / enteredBy / createdAt / updatedAt / FK→valorant_pick_sessions (Cascade)

## CRUD 表（機能単位）

行＝機能、列＝代表テーブル。C/R/U/D はその機能が通常行う操作（コードのエンドポイント単位の精査は未実施＝「機能レベルの論理 CRUD」であり、Phase 4 の repo 配置時にコード照合で確定させる）。

| 機能                 | 対象テーブル                                                                                       | C   | R                     | U   | D                       |
| -------------------- | -------------------------------------------------------------------------------------------------- | --- | --------------------- | --- | ----------------------- |
| ギルド登録・設定     | guilds, guild_settings, spam_settings, moderation_settings                                         | ✓   | ✓                     | ✓   |                         |
| メンバー・ロール管理 | users, guild_members, roles, user_roles                                                            | ✓   | ✓                     | ✓   | ✓                       |
| 監査ログ             | audit_logs                                                                                         | ✓   | ✓                     |     |                         |
| プラグイン管理       | plugins, guild_plugins, guild_plugin_config_history                                                | ✓   | ✓                     | ✓   |                         |
| ルールエンジン       | rules, rule_execution_logs                                                                         | ✓   | ✓                     | ✓   | ✓                       |
| 自動応答             | auto_responses, auto_response_execution_events                                                     | ✓   | ✓                     | ✓   | ✓                       |
| モデレーション       | mod_actions, word_filters, moderation_detection_events, moderation_blacklist_entries               | ✓   | ✓                     | ✓   |                         |
| 名言                 | quotes                                                                                             | ✓   | ✓                     | ✓   | ✓                       |
| 募集 (LFG)           | lfg_posts, lfg_participants                                                                        | ✓   | ✓                     | ✓   | ✓（論理削除 deletedAt） |
| チーム分け           | team_split_sessions, team_split_participants                                                       | ✓   | ✓                     | ✓   | ✓（論理削除）           |
| 日次配信             | daily_contents, daily_content_deliveries                                                           | ✓   | ✓                     | ✓   | ✓（論理削除）           |
| イベント             | community_events, event_rsvps                                                                      | ✓   | ✓                     | ✓   |                         |
| コミュニティ集計     | `community_*_daily`, `*_sessions`, achievement_unlocks, `challenge_*`, `season_snapshots*`         | ✓   | ✓                     | ✓   |                         |
| MBTI                 | mbti_*                                                                                             | ✓   | ✓                     | ✓   |                         |
| AI 生成・予算        | ai_generation_events, ai_guild_monthly_budget_usage, ai_user_model_preferences                     | ✓   | ✓                     | ✓   |                         |
| Studio アクセス制御  | studio_access_policies, studio_access_groups, *_members, *_attachments, studio_user_preferences    | ✓   | ✓                     | ✓   | ✓                       |
| ランタイム秘密       | runtime_secrets                                                                                    | ✓   | ✓（復号は実行時のみ） | ✓   |                         |
| VC Recap・同意       | vc_recap_*, user_data_consents, voice_consent_access                                               | ✓   | ✓                     | ✓   | ✓（消去リクエスト経由） |
| Daily ボーナス・占い | `daily_bonus_*`, anniversary_events, fortune_profiles, `birthday_card_*`                           | ✓   | ✓                     | ✓   |                         |
| Valorant             | valorant_rosters, valorant_agents, valorant_account_links, valorant_pick_*, valorant_match_results | ✓   | ✓                     | ✓   |                         |

## 変更管理

- 正本は Prisma schema と `packages/db/prisma/migrations/`。本書は生成物であり、schema が変わったら再生成して版を上げる（生成元の commit を改版履歴に残す）。
- 実 DB との突合（101 vs 80 の差分内訳）は未実施の照合タスクとして台帳に残す。

## 改版履歴

| 版     | 日付       | 変更内容                                                                       | 変更者 | 承認者               |
| ------ | ---------- | ------------------------------------------------------------------------------ | ------ | -------------------- |
| v1.0.0 | 2026-11-10 | 初版。schema.prisma (bd6cbabb) から ER図・全80テーブルの定義・機能 CRUD を生成 | Muse   | 未（Phase 4 配置時） |
