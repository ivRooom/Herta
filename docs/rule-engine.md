# Herta. — Rule Engine 設計書

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 概要

Rule Engine は Herta. の自動化基盤である。Discord イベントを Trigger として受け取り、Condition を評価し、Action を実行する 3 段パイプラインで動作する。

```
WHEN <Trigger> IF <Conditions> THEN <Actions>
```

全ての Plugin は Rule Engine に Trigger / Condition / Action を登録でき、ユーザーは Dashboard の Visual Rule Builder からルールを作成・編集できる。

---

## 2. アーキテクチャ

```
Discord Event
     │
     ▼
┌─────────────────┐
│  Event Router   │  Bot が受信したイベントを分類
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Rule Evaluator  │  Guild のアクティブルールを取得 (priority 降順)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Trigger Match   │  イベントが Rule の Trigger に一致するか
└────────┬────────┘
         │ YES
         ▼
┌─────────────────┐
│ Condition Check │  Condition ツリーを評価 (AND/OR/NOT)
└────────┬────────┘
         │ ALL PASS
         ▼
┌─────────────────┐
│ Action Executor │  Action を順次 or 並列実行
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Execution Log  │  結果を DB に記録
└─────────────────┘
```

---

## 3. Trigger 定義

### 3.1 インタフェース

```typescript
export interface TriggerDefinition {
  type: string;
  name: string;
  description: string;
  configSchema: Record<string, unknown>;
  evaluate(event: TriggerEvent, config: Record<string, unknown>): Promise<boolean>;
}

export interface TriggerEvent {
  type: string;
  guildId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}
```

### 3.2 組み込み Trigger 一覧

| Type | 説明 | 提供元 |
|---|---|---|
| `messageCreate` | メッセージ作成 | Core |
| `messageUpdate` | メッセージ編集 | Core |
| `messageDelete` | メッセージ削除 | Core |
| `memberJoin` | メンバー参加 | Core |
| `memberLeave` | メンバー退出 | Core |
| `reactionAdd` | リアクション追加 | Core |
| `reactionRemove` | リアクション削除 | Core |
| `buttonClick` | ボタンクリック | Core |
| `selectMenu` | セレクトメニュー選択 | Core |
| `modalSubmit` | モーダル送信 | Core |
| `schedule` | スケジュール (cron) | Core |
| `webhook` | 外部 Webhook 受信 | Core |
| `api` | API コール | Core |

### 3.3 Plugin が追加する Trigger

| Type | 説明 | Plugin |
|---|---|---|
| `auto-response.match` | 自動応答マッチ | auto-response |
| `moderation.wordFilter` | NGワード検知 | moderation |
| `moderation.spamDetected` | スパム検知 | moderation |
| `moderation.inviteDetected` | 招待リンク検知 | moderation |
| `quote.created` | 名言登録 | quote |
| `quote.shown` | 名言表示 | quote |
| `quote.deleted` | 名言削除 | quote |
| `lfg.created` | LFG 作成 | lfg |
| `lfg.closed` | LFG 終了 | lfg |

---

## 4. Condition 定義

### 4.1 インタフェース

```typescript
export interface ConditionDefinition {
  type: string;
  name: string;
  description: string;
  configSchema: Record<string, unknown>;
  evaluate(context: RuleContext, config: Record<string, unknown>): Promise<boolean>;
}
```

### 4.2 Condition ツリー構造

Condition は AND だけでなく、ツリー構造で論理結合を表現できる。

```typescript
export interface ConditionNode {
  type: 'and' | 'or' | 'not' | string;
  config?: Record<string, unknown>;
  children?: ConditionNode[];  // and / or / not の場合
}
```

**評価ロジック:**

```typescript
async function evaluateConditionTree(
  node: ConditionNode,
  context: RuleContext,
): Promise<boolean> {
  switch (node.type) {
    case 'and':
      for (const child of node.children ?? []) {
        if (!(await evaluateConditionTree(child, context))) return false;
      }
      return true;

    case 'or':
      for (const child of node.children ?? []) {
        if (await evaluateConditionTree(child, context)) return true;
      }
      return false;

    case 'not':
      if (!node.children?.[0]) return true;
      return !(await evaluateConditionTree(node.children[0], context));

    default:
      // リーフノード: 登録された Condition を実行
      return registry.evaluate(node.type, context, node.config ?? {});
  }
}
```

### 4.3 組み込み Condition 一覧

| Type | 説明 | 設定例 |
|---|---|---|
| `role` | ユーザーが特定ロールを持つ | `{ roleId: "..." }` |
| `channel` | 特定チャンネル | `{ channelId: "..." }` |
| `category` | 特定カテゴリ | `{ categoryId: "..." }` |
| `keyword` | メッセージにキーワードを含む | `{ keyword: "...", mode: "exact" }` |
| `regex` | メッセージが正規表現にマッチ | `{ pattern: "..." }` |
| `contains` | メッセージにテキストを含む | `{ text: "..." }` |
| `cooldown` | クールダウン中でない | `{ seconds: 30 }` |
| `time` | 特定時間帯 | `{ start: "09:00", end: "18:00" }` |
| `permission` | Discord パーミッション | `{ permission: "MANAGE_MESSAGES" }` |
| `user` | 特定ユーザー | `{ userId: "..." }` |
| `bot` | Bot かどうか | `{ isBot: true }` |
| `messageLength` | メッセージ文字数 | `{ min: 1, max: 500 }` |
| `attachments` | 添付ファイルの有無/数 | `{ min: 1 }` |
| `not` | 否定 (ラッパー) | `{ children: [...] }` |
| `or` | OR グループ (ラッパー) | `{ children: [...] }` |
| `and` | AND グループ (ラッパー) | `{ children: [...] }` |

---

## 5. Action 定義

### 5.1 インタフェース

```typescript
export interface ActionDefinition {
  type: string;
  name: string;
  description: string;
  configSchema: Record<string, unknown>;
  execute(context: RuleContext, config: Record<string, unknown>): Promise<ActionResult>;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}
```

### 5.2 組み込み Action 一覧

| Type | 説明 | 設定例 |
|---|---|---|
| `reply` | メッセージに返信 | `{ content: "..." }` |
| `send` | チャンネルにメッセージ送信 | `{ channelId: "...", content: "..." }` |
| `embed` | Embed 送信 | `{ channelId: "...", embed: {...} }` |
| `react` | リアクション追加 | `{ emoji: "👍" }` |
| `deleteMessage` | メッセージ削除 | `{}` |
| `roleAdd` | ロール付与 | `{ roleId: "..." }` |
| `roleRemove` | ロール剥奪 | `{ roleId: "..." }` |
| `createThread` | スレッド作成 | `{ name: "..." }` |
| `sendDM` | DM 送信 | `{ content: "..." }` |
| `sendWebhook` | 外部 Webhook 送信 | `{ url: "...", body: {...} }` |
| `warn` | ユーザー警告 | `{ reason: "..." }` |
| `mute` | ミュート (タイムアウト) | `{ durationMs: 300000 }` |
| `kick` | キック | `{ reason: "..." }` |
| `ban` | BAN | `{ reason: "...", deleteDays: 1 }` |
| `log` | ログチャンネルに記録 | `{ channelId: "...", content: "..." }` |
| `wait` | 遅延 (チェーン用) | `{ ms: 5000 }` |
| `conditional` | 条件分岐アクション | `{ condition: {...}, then: [...], else: [...] }` |

### 5.3 Action 実行モデル

```typescript
interface ActionExecutionConfig {
  /** 実行モード */
  mode: 'sequential' | 'parallel';

  /** エラー時の挙動 */
  onError: 'stopOnError' | 'continueOnError';
}
```

- **sequential** (デフォルト): Action を順番に実行。前の Action の結果を次の Action で参照可能
- **parallel**: 独立した Action を同時に実行
- **stopOnError**: エラー発生時に残りの Action をスキップ
- **continueOnError**: エラーが発生しても残りの Action を続行

---

## 6. RuleContext

```typescript
export interface RuleContext {
  /** Guild ID */
  guildId: string;

  /** トリガーイベント */
  event: TriggerEvent;

  /** イベントを発火したユーザー */
  user?: DiscordUser;

  /** メッセージ (該当する場合) */
  message?: Message;

  /** チャンネル */
  channel?: Channel;

  /** ルール実行中に蓄積される変数 */
  variables: Map<string, unknown>;

  /** Discord クライアント */
  discord: Client;

  /** DB クライアント */
  db: PrismaClient;

  /** Redis クライアント */
  cache: ScopedRedisClient;
}
```

---

## 7. テンプレート変数

Rule の Action 設定内で `{{変数名}}` を使用でき、実行時に RuleContext から解決される。

### 7.1 利用可能な変数

| 変数 | 説明 | 例 |
|---|---|---|
| `{{user.id}}` | ユーザー ID | `123456789` |
| `{{user.mention}}` | ユーザーメンション | `<@123456789>` |
| `{{user.username}}` | ユーザー名 | `taro` |
| `{{user.displayName}}` | 表示名 | `太郎` |
| `{{channel.id}}` | チャンネル ID | `987654321` |
| `{{channel.name}}` | チャンネル名 | `general` |
| `{{channel.mention}}` | チャンネルメンション | `<#987654321>` |
| `{{guild.id}}` | Guild ID | `111222333` |
| `{{guild.name}}` | Guild 名 | `My Server` |
| `{{message.content}}` | メッセージ内容 | `こんにちは` |
| `{{message.id}}` | メッセージ ID | `444555666` |
| `{{timestamp}}` | 実行時刻 (ISO) | `2026-06-30T12:00:00Z` |

### 7.2 テンプレートエンジンの安全性

- `handlebars` ライブラリを使用 (自作しない)
- **ホワイトリスト方式**: 上記の変数のみアクセス可能
- `{{constructor}}`, `{{__proto__}}` 等のプロトタイプ汚染を遮断
- 再帰的テンプレート展開を禁止 (1回のみ展開)
- 出力の最大長を制限 (2000 文字 = Discord メッセージ上限)

---

## 8. Rule の JSON スキーマ

### 8.1 バージョニング

Rule の JSON 構造にはバージョンフィールドを含める。

```json
{
  "schemaVersion": 1,
  "name": "Welcome Message",
  "trigger": {
    "type": "memberJoin",
    "config": {}
  },
  "conditions": [
    {
      "type": "not",
      "children": [
        { "type": "bot", "config": {} }
      ]
    }
  ],
  "actions": [
    {
      "type": "send",
      "config": {
        "channelId": "{{welcomeChannel}}",
        "content": "ようこそ {{user.mention}} さん！"
      }
    },
    {
      "type": "roleAdd",
      "config": {
        "roleId": "{{memberRole}}"
      }
    }
  ]
}
```

### 8.2 スキーマのマイグレーション

`schemaVersion` が古い Rule は、ロード時に自動的に最新バージョンに変換する。

```typescript
function migrateRule(rule: RuleJson): RuleJson {
  let current = rule;
  while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
    current = migrations[current.schemaVersion](current);
  }
  return current;
}
```

---

## 9. セキュリティ

### 9.1 外部通信の制限

`sendWebhook` Action は SSRF (Server Side Request Forgery) のリスクがある。

| 対策 | 実装 |
|---|---|
| URL ホワイトリスト | Guild 管理者が許可する外部ドメインを登録 |
| 内部ネットワーク遮断 | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1` を遮断 |
| DNS リバインディング対策 | 解決後の IP アドレスを検証 |
| タイムアウト | 5 秒 |
| レスポンスサイズ制限 | 1 MB |

### 9.2 Rate Limit

| スコープ | 制限 |
|---|---|
| Guild 単位 | 100 ルール実行 / 分 |
| Rule 単位 | `cooldownMs` (ルールごとに設定) |
| Action 単位 | `sendWebhook`: 10 回 / 分 / Guild |

### 9.3 リソース制限

| リソース | 制限 |
|---|---|
| 1 Guild あたりの Rule 数 | 100 (Free), 500 (Pro) |
| 1 Rule あたりの Condition 数 | 20 |
| 1 Rule あたりの Action 数 | 10 |
| Condition ツリーの最大深度 | 5 |
| テンプレート展開後の最大長 | 2000 文字 |
| `wait` Action の最大遅延 | 60 秒 |

---

## 10. Visual Rule Builder (Dashboard)

### 10.1 UI 構成

```
┌─────────────────────────────────────────────────────────────┐
│  Rule Builder: "Welcome Message"                    [保存]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  WHEN (トリガー)                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ メンバー参加                                 [▼]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  IF (条件)                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ NOT → Bot である                       [✕] [+ 追加] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  THEN (アクション)                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. メッセージ送信                                   │   │
│  │    チャンネル: #welcome                              │   │
│  │    内容: ようこそ {{user.mention}} さん！            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 2. ロール付与                                       │   │
│  │    ロール: @Member                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  [+ アクション追加]                                         │
│                                                             │
│  ─── 詳細設定 ───                                           │
│  クールダウン: [0] ms   優先度: [0]   最大実行回数: [∞]     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Rule Builder の出力

UI は上記のような操作から以下の JSON を生成し、API に送信する。

```json
{
  "name": "Welcome Message",
  "description": "新規メンバーにウェルカムメッセージを送信",
  "trigger": { "type": "memberJoin", "config": {} },
  "conditions": [
    {
      "type": "not",
      "children": [{ "type": "bot", "config": {} }]
    }
  ],
  "actions": [
    {
      "type": "send",
      "config": {
        "channelId": "123456789",
        "content": "ようこそ {{user.mention}} さん！"
      }
    },
    {
      "type": "roleAdd",
      "config": { "roleId": "987654321" }
    }
  ],
  "cooldownMs": 0,
  "priority": 0,
  "maxExecutions": null
}
```

---

## 11. 実行ログ

全ての Rule 実行は `rule_execution_logs` テーブルに記録される。

```typescript
interface RuleExecutionLog {
  id: string;
  ruleId: string;
  guildId: string;
  triggerEvent: Record<string, unknown>;  // トリガーイベントの要約
  conditionsMet: boolean;
  actionsResult: Array<{ type: string; success: boolean; error?: string }>;
  error: string | null;
  durationMs: number;
  executedAt: Date;
}
```

**保持期間:** 30 日 (Worker のクリーンアップジョブで自動削除)
