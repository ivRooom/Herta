# Herta. — Database 設計書

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 概要

| 項目 | 値 |
|---|---|
| DBMS | PostgreSQL 16 |
| ORM | Prisma |
| キャッシュ | Redis 7 |
| マイグレーション | Prisma Migrate |
| 接続 | SSL 必須 |

---

## 2. 設計原則

1. **Guild 分離**: 全テーブルに `guild_id` カラムを持ち、データを Guild 単位で分離する
2. **Core / Plugin 分離**: Guild モデルは Core リレーションのみ保持。Plugin テーブルは `guild_id` の FK で直接 `guilds` を参照する
3. **Append-only Audit**: `audit_logs` テーブルは追記のみ。DELETE / UPDATE を制限する
4. **バージョニング**: 設定変更は `guild_plugin_config_history` で自動記録し、ロールバック可能にする
5. **インデックス戦略**: `[guild_id, enabled]` と `[guild_id, created_at]` を全 Plugin テーブルに共通適用する

---

## 3. ER 図

```
┌─────────────┐     1:N     ┌──────────────┐    N:1     ┌──────────┐
│   guilds    │────────────▶│ guild_members │◀───────────│  users   │
│             │             │              │            │          │
│ id (PK)     │             │ guild_id (FK)│            │ id (PK)  │
│ name        │             │ user_id (FK) │            │ username │
│ plan        │             │ nickname     │            │ email    │
│ features    │             │ roles[]      │            └──────────┘
└──────┬──────┘             └──────────────┘                 │
       │                                                      │
       │ 1:1                                                  │
       ▼                                                      │
┌──────────────┐                                              │
│guild_settings│                                              │
│              │                                              │
│ guild_id(PK) │                                              │
│ prefix       │                                              │
│ version      │                                              │
└──────────────┘                                              │
       │                                                      │
       │ 1:N                   1:N                           │
       ├──────────────────────────────┐                      │
       ▼                              ▼                      │
┌──────────────┐              ┌────────────────┐             │
│    roles     │              │  audit_logs    │             │
│              │              │                │             │
│ id (PK)      │              │ id (PK)        │             │
│ guild_id(FK) │              │ guild_id (FK)  │             │
│ name         │              │ actor_id       │◀────────────┘
│ permissions[]│              │ event          │
│ position     │              │ severity       │
└──────┬───────┘              └────────────────┘
       │
       │ M:N (user_roles)
       ▼
┌──────────────┐
│  user_roles  │
│              │
│ guild_id     │
│ user_id      │
│ role_id (FK) │
└──────────────┘

┌──────────────┐     N:1     ┌──────────────┐
│guild_plugins │────────────▶│   plugins    │
│              │             │              │
│ guild_id(FK) │             │ id (PK)      │
│ plugin_id(FK)│             │ name         │
│ enabled      │             │ version      │
│ config(JSONB)│             │ manifest     │
│ config_ver   │             │ category     │
└──────┬───────┘             └──────────────┘
       │
       │ 1:N
       ▼
┌──────────────────────────┐
│guild_plugin_config_hist. │
│                          │
│ id (PK)                  │
│ guild_id, plugin_id      │
│ version                  │
│ config (JSONB)           │
│ changed_by               │
└──────────────────────────┘

┌──────────────┐     1:N     ┌────────────────────┐
│    rules     │────────────▶│rule_execution_logs │
│              │             │                    │
│ id (PK)      │             │ id (PK)            │
│ guild_id(FK) │             │ rule_id (FK)       │
│ plugin_id    │             │ trigger_event      │
│ trigger      │             │ conditions_met     │
│ conditions[] │             │ actions_result     │
│ actions[]    │             │ duration_ms        │
│ schema_ver   │             └────────────────────┘
│ priority     │
│ cooldown_ms  │
└──────────────┘
```

---

## 4. Core テーブル

### 4.1 guilds

Discord Guild の基本情報。

```prisma
model Guild {
  id        String   @id                          // Discord Guild ID
  name      String
  icon      String?
  ownerId   String   @map("owner_id")
  plan      String   @default("free")             // free | pro | enterprise
  locale    String   @default("ja")
  timezone  String   @default("Asia/Tokyo")
  features  Json     @default("[]")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Core リレーションのみ
  settings      GuildSettings?
  members       GuildMember[]
  roles         Role[]
  auditLogs     AuditLog[]
  guildPlugins  GuildPlugin[]
  rules         Rule[]

  @@map("guilds")
}
```

> **設計判断:** Plugin 固有のリレーション (`quotes`, `lfgPosts` 等) は Guild モデルに定義しない。Plugin テーブルは `guildId` の FK で直接 `guilds` を参照する。

### 4.2 guild_settings

Guild ごとの設定。

```prisma
model GuildSettings {
  guildId      String   @id @map("guild_id")
  prefix       String   @default("!")
  logChannelId String?  @map("log_channel_id")
  modRoleIds   String[] @map("mod_role_ids")
  adminRoleIds String[] @map("admin_role_ids")
  locale       String   @default("ja")
  settingsJson Json     @default("{}") @map("settings_json")
  version      Int      @default(1)
  updatedAt    DateTime @updatedAt @map("updated_at")

  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@map("guild_settings")
}
```

### 4.3 users

Discord ユーザー情報。

```prisma
model User {
  id            String   @id                      // Discord User ID
  username      String
  discriminator String?
  avatar        String?
  email         String?
  locale        String?
  isAdmin       Boolean  @default(false) @map("is_admin")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  memberships GuildMember[]

  @@map("users")
}
```

> **設計判断:** `accessToken` (Discord OAuth) は User テーブルに保存しない。Redis に短期間のみ保持するか、JWT のクレームに含める。

### 4.4 guild_members

Guild と User の中間テーブル。

```prisma
model GuildMember {
  guildId  String    @map("guild_id")
  userId   String    @map("user_id")
  nickname String?
  joinedAt DateTime? @map("joined_at")
  roles    String[]

  guild     Guild      @relation(fields: [guildId], references: [id], onDelete: Cascade)
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  userRoles UserRole[]

  @@id([guildId, userId])
  @@map("guild_members")
}
```

### 4.5 roles (RBAC)

```prisma
model Role {
  id          String   @id @default(uuid())
  guildId     String   @map("guild_id")
  name        String
  permissions String[]
  isDefault   Boolean  @default(false) @map("is_default")
  position    Int      @default(0)
  createdAt   DateTime @default(now()) @map("created_at")

  guild     Guild      @relation(fields: [guildId], references: [id], onDelete: Cascade)
  userRoles UserRole[]

  @@map("roles")
}
```

> **設計判断:** デフォルトロールは `view` 権限のみ (最小権限の原則)。

### 4.6 user_roles

```prisma
model UserRole {
  guildId    String   @map("guild_id")
  userId     String   @map("user_id")
  roleId     String   @map("role_id")
  assignedBy String?  @map("assigned_by")
  assignedAt DateTime @default(now()) @map("assigned_at")

  member GuildMember @relation(fields: [guildId, userId], references: [guildId, userId], onDelete: Cascade)
  role   Role        @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([guildId, userId, roleId])
  @@map("user_roles")
}
```

### 4.7 audit_logs

```prisma
model AuditLog {
  id         String   @id @default(uuid())
  guildId    String   @map("guild_id")
  actorId    String   @map("actor_id")
  actorType  String   @default("user") @map("actor_type")  // user | bot | system
  event      String                                         // plugin.enable, rule.create 等
  targetType String?  @map("target_type")
  targetId   String?  @map("target_id")
  changes    Json?                                          // { field: { old, new } }
  metadata   Json?
  severity   String   @default("info")                      // info | warning | critical
  ipAddress  String?  @map("ip_address")
  sessionId  String?  @map("session_id")
  createdAt  DateTime @default(now()) @map("created_at")

  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@index([guildId, createdAt(sort: Desc)])
  @@index([guildId, event])
  @@index([guildId, actorId])
  @@map("audit_logs")
}
```

### 4.8 plugins (レジストリ)

```prisma
model Plugin {
  id          String   @id                        // "moderation", "auto-response"
  name        String
  description String?
  version     String
  author      String?
  category    String?                              // core | moderation | fun | game | utility | analytics
  isOfficial  Boolean  @default(false) @map("is_official")
  manifest    Json
  createdAt   DateTime @default(now()) @map("created_at")

  guildPlugins GuildPlugin[]

  @@map("plugins")
}
```

### 4.9 guild_plugins

```prisma
model GuildPlugin {
  guildId       String   @map("guild_id")
  pluginId      String   @map("plugin_id")
  enabled       Boolean  @default(true)
  config        Json     @default("{}")
  configVersion Int      @default(1) @map("config_version")
  installedAt   DateTime @default(now()) @map("installed_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  guild         Guild                    @relation(fields: [guildId], references: [id], onDelete: Cascade)
  plugin        Plugin                   @relation(fields: [pluginId], references: [id])
  configHistory GuildPluginConfigHistory[]

  @@id([guildId, pluginId])
  @@map("guild_plugins")
}
```

### 4.10 guild_plugin_config_history

```prisma
model GuildPluginConfigHistory {
  id           String   @id @default(uuid())
  guildId      String   @map("guild_id")
  pluginId     String   @map("plugin_id")
  version      Int
  config       Json
  changedBy    String   @map("changed_by")
  changeReason String?  @map("change_reason")
  createdAt    DateTime @default(now()) @map("created_at")

  guildPlugin GuildPlugin @relation(fields: [guildId, pluginId], references: [guildId, pluginId], onDelete: Cascade)

  @@map("guild_plugin_config_history")
}
```

### 4.11 rules

```prisma
model Rule {
  id             String   @id @default(uuid())
  guildId        String   @map("guild_id")
  pluginId       String?  @map("plugin_id")
  name           String
  description    String?
  enabled        Boolean  @default(true)
  priority       Int      @default(0)
  schemaVersion  Int      @default(1) @map("schema_version")
  trigger        Json                                       // { type, config }
  conditions     Json     @default("[]")                    // ConditionNode ツリー
  actions        Json     @default("[]")                    // [{ type, config }]
  cooldownMs     Int      @default(0) @map("cooldown_ms")
  maxExecutions  Int?     @map("max_executions")
  executionCount Int      @default(0) @map("execution_count")
  createdBy      String   @map("created_by")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  guild         Guild              @relation(fields: [guildId], references: [id], onDelete: Cascade)
  executionLogs RuleExecutionLog[]

  @@index([guildId, enabled])
  @@map("rules")
}
```

### 4.12 rule_execution_logs

```prisma
model RuleExecutionLog {
  id            String   @id @default(uuid())
  ruleId        String   @map("rule_id")
  guildId       String   @map("guild_id")
  triggerEvent  Json     @map("trigger_event")
  conditionsMet Boolean  @map("conditions_met")
  actionsResult Json?    @map("actions_result")
  error         String?
  durationMs    Int?     @map("duration_ms")
  executedAt    DateTime @default(now()) @map("executed_at")

  rule Rule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([guildId, executedAt(sort: Desc)])
  @@map("rule_execution_logs")
}
```

---

## 5. Plugin テーブル

### 5.1 Auto Response

```prisma
model AutoResponse {
  id              String   @id @default(uuid())
  guildId         String   @map("guild_id")
  name            String
  triggerType     String   @map("trigger_type")       // keyword | regex
  triggerValue    String   @map("trigger_value")
  matchMode       String   @default("partial") @map("match_mode")  // exact | partial
  responseType    String   @default("text") @map("response_type")  // text | embed | reaction
  responseContent String   @map("response_content")
  channelIds      String[] @map("channel_ids")
  roleIds         String[] @map("role_ids")
  cooldownSeconds Int      @default(0) @map("cooldown_seconds")
  enabled         Boolean  @default(true)
  createdBy       String?  @map("created_by")
  updatedBy       String?  @map("updated_by")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([guildId, enabled])
  @@map("auto_responses")
}
```

### 5.2 Moderation

```prisma
model ModAction {
  id          String    @id @default(uuid())
  guildId     String    @map("guild_id")
  targetId    String    @map("target_id")
  moderatorId String    @map("moderator_id")
  actionType  String    @map("action_type")     // warn | mute | kick | ban | unmute | unban
  reason      String?
  durationMs  BigInt?   @map("duration_ms")
  expiresAt   DateTime? @map("expires_at")
  active      Boolean   @default(true)
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([guildId, targetId])
  @@map("mod_actions")
}

model WordFilter {
  id             String   @id @default(uuid())
  guildId        String   @map("guild_id")
  pattern        String
  patternType    String   @default("exact") @map("pattern_type")  // exact | contains | regex
  action         String   @default("delete")                       // delete | warn | timeout
  reason         String?
  caseSensitive  Boolean  @default(false) @map("case_sensitive")
  exemptRoles    String[] @default([]) @map("exempt_roles")
  exemptChannels String[] @default([]) @map("exempt_channels")
  enabled        Boolean  @default(true)
  createdBy      String?  @map("created_by")
  updatedBy      String?  @map("updated_by")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@index([guildId, enabled])
  @@map("word_filters")
}

model SpamSettings {
  guildId            String  @id @map("guild_id")
  maxMessages        Int     @default(5) @map("max_messages")
  timeWindowMs       Int     @default(5000) @map("time_window_ms")
  maxMentions        Int     @default(10) @map("max_mentions")
  maxLinks           Int     @default(3) @map("max_links")
  duplicateThreshold Int     @default(3) @map("duplicate_threshold")
  action             String  @default("timeout")
  timeoutDurationMs  BigInt  @default(300000) @map("timeout_duration_ms")
  enabled            Boolean @default(true)

  @@map("spam_settings")
}

model ModerationSettings {
  guildId            String   @id @map("guild_id")
  enableWordFilter   Boolean  @default(true) @map("enable_word_filter")
  enableInviteFilter Boolean  @default(false) @map("enable_invite_filter")
  enableSpamFilter   Boolean  @default(true) @map("enable_spam_filter")
  logChannelId       String?  @map("log_channel_id")
  exemptRoles        String[] @default([]) @map("exempt_roles")
  exemptChannels     String[] @default([]) @map("exempt_channels")
  allowedInvites     String[] @default([]) @map("allowed_invites")
  inviteAction       String   @default("delete") @map("invite_action")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@map("moderation_settings")
}
```

### 5.3 Quote

```prisma
model Quote {
  id               String   @id @default(uuid())
  guildId          String   @map("guild_id")
  quoteNumber      Int      @map("quote_number")
  quoteText        String   @map("quote_text")
  sourceMessageId  String?  @map("source_message_id")
  sourceChannelId  String?  @map("source_channel_id")
  sourceMessageUrl String?  @map("source_message_url")
  sourceAuthorId   String?  @map("source_author_id")
  sourceAuthorName String?  @map("source_author_name")
  registeredById   String   @map("registered_by_id")
  registeredByName String   @map("registered_by_name")
  tags             String[] @default([])
  status           String   @default("public")     // public | hidden | deleted
  isNsfw           Boolean  @default(false) @map("is_nsfw")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@unique([guildId, quoteNumber])
  @@index([guildId, status])
  @@map("quotes")
}
```

### 5.4 LFG

```prisma
model LfgPost {
  id          String    @id @default(uuid())
  guildId     String    @map("guild_id")
  creatorId   String    @map("creator_id")
  game        String
  title       String
  description String?
  maxPlayers  Int       @default(5) @map("max_players")
  startTime   DateTime? @map("start_time")
  channelId   String    @map("channel_id")
  messageId   String?   @map("message_id")
  status      String    @default("open")        // open | full | closed | cancelled
  createdAt   DateTime  @default(now()) @map("created_at")

  participants LfgParticipant[]

  @@index([guildId, status])
  @@map("lfg_posts")
}

model LfgParticipant {
  lfgId    String   @map("lfg_id")
  userId   String   @map("user_id")
  status   String   @default("joined")          // joined | tentative | declined
  joinedAt DateTime @default(now()) @map("joined_at")

  lfgPost LfgPost @relation(fields: [lfgId], references: [id], onDelete: Cascade)

  @@id([lfgId, userId])
  @@map("lfg_participants")
}
```

### 5.5 Team Split

```prisma
model TeamSplitSession {
  id           String   @id @default(uuid())
  guildId      String   @map("guild_id")
  creatorId    String   @map("creator_id")
  channelId    String   @map("channel_id")
  teamCount    Int      @default(2) @map("team_count")
  mode         String   @default("random")       // random | balanced | captains
  participants String[] @default([])
  teams        Json?                              // [{ name, members[] }]
  status       String   @default("pending")       // pending | active | completed
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([guildId, createdAt(sort: Desc)])
  @@map("team_split_sessions")
}
```

### 5.6 Daily Content

```prisma
model DailyContent {
  id           String    @id @default(uuid())
  guildId      String    @map("guild_id")
  channelId    String    @map("channel_id")
  title        String    @default("")
  content      String
  scheduleTime String    @map("schedule_time")    // HH:mm
  timezone     String    @default("Asia/Tokyo")
  enabled      Boolean   @default(true)
  lastSentAt   DateTime? @map("last_sent_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@index([guildId, enabled])
  @@map("daily_contents")
}
```

---

## 6. インデックス戦略

### 6.1 共通パターン

全 Plugin テーブルに以下のインデックスを適用する:

```
@@index([guildId, enabled])      // 有効レコードの検索
@@index([guildId, createdAt])    // 時系列の検索
```

### 6.2 Audit Log のインデックス

```
@@index([guildId, createdAt(sort: Desc)])   // 最新ログの取得
@@index([guildId, event])                    // イベント種別でのフィルタ
@@index([guildId, actorId])                  // 操作者でのフィルタ
```

---

## 7. Redis の使用方針

| 用途 | キーパターン | TTL |
|---|---|---|
| セッション | `session:<sessionId>` | 7 日 |
| Rate Limit | `ratelimit:<guildId>:<endpoint>` | 60 秒 |
| Plugin キャッシュ | `plugin:<pluginId>:<guildId>:<key>` | Plugin が指定 |
| Rule Cooldown | `cooldown:<ruleId>:<guildId>` | `cooldownMs` |
| Guild 設定キャッシュ | `guild:<guildId>:settings` | 5 分 |
| Plugin 設定キャッシュ | `guild:<guildId>:plugin:<pluginId>:config` | 5 分 |
| BullMQ Queue | `bull:<queueName>:*` | BullMQ 管理 |

---

## 8. バックアップ戦略

| 対象 | 方式 | 頻度 | 保持期間 |
|---|---|---|---|
| PostgreSQL | `pg_dump` → S3 | 日次 | 30 日 |
| Redis | RDB スナップショット | 1 時間 | 24 時間 |
| Config 履歴 | `guild_plugin_config_history` テーブル | 自動 (設定変更時) | 無期限 |

---

## 9. マイグレーション運用

### 9.1 開発環境

```bash
# スキーマ変更後
pnpm db:generate      # Prisma Client 再生成
pnpm db:migrate       # マイグレーション作成 + 適用
```

### 9.2 本番環境

```bash
# Docker Compose の migrator サービスが自動実行
# docker-compose.prod.yml の migrator コンテナ:
#   command: pnpm --filter @herta/db migrate:deploy
```

### 9.3 マイグレーション規約

- マイグレーション名は内容を表す英語: `add_audit_log_severity`
- 破壊的変更 (カラム削除、型変更) は 2 段階で行う:
  1. 新カラム追加 + データ移行
  2. 旧カラム削除
- 本番適用前にステージング環境で検証する
