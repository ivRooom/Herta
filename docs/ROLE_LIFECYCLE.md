# Discord Role Lifecycle

Herta Role ManagerのDiscord Role本体に対する作成・削除・予約・期間限定運用の設計と運用上の注意をまとめる。

## 対象範囲

実装済み:

- StudioからDiscord Roleを即時作成
- Studioから指定日時にDiscord Roleを作成
- 一時Roleとして作成し、作成成功から一定期間後に自動削除
- Studioから既存Discord Roleを削除
- 作成・削除要求と実行結果のAudit Log
- Role操作履歴の表示
- Worker再起動時のstale operation reconcile
- deleteの安全な再試行
- Herta設定 / Plugin configから参照中のRole削除防止
- Discord Role削除成功後の孤児Studio Role Policy cleanup
- Discord作成成功後にDB確定が失敗した場合の補償削除

今回の対象外:

- 任意のDiscordイベントやHertaイベントをTriggerとしたRole作成
- Role作成予約の編集・キャンセル
- 作成するRoleへのDiscord Permission付与
- Role hierarchy上の任意position指定

## 責務分離

```text
Studio
  ↓ request validation / root authorization / live Guild validation
PostgreSQL: discord_role_operations
  ↓ due scan / claim / retry / TTL scheduling
Worker
  ↓ BOT_INTERNAL_API_SECRET
Bot internal API
  ↓ Discord Bot Token
Discord API
```

### Studio

StudioはBot Tokenを保持せず、Role操作を`discord_role_operations`へ予約する。

変更操作では以下を必須とする。

- Auth.js session
- Same-Origin
- OWNER root Role
- 対象Guildのlive再確認
- BotのManage Roles確認
- Role ID validation
- Managed Role / hierarchy / root Role / `@everyone`保護
- Herta GuildSettings / Plugin configからの参照確認
- bounded request body

Role削除要求は、`modRoleIds` / `adminRoleIds` / `settingsJson` / Guild Plugin configから対象Role IDが参照されている場合に409で拒否する。削除成功後に自動cleanupするStudio Role Policyだけはこの参照判定から除外する。JSON参照探索は完全一致のみ、最大深度16・返却20件までに制限し、異常に深い設定や巨大な参照一覧で処理が無制限にならないようにする。

### Worker

WorkerはDBを正本としてdue operationを走査する。

- default interval: 15秒
- 設定範囲: 5〜300秒
- 1 cycle最大25件
- atomic claimで多重実行を抑止
- 5分を超えるstale claimをreconcile

WorkerはDiscord Bot TokenをRole Lifecycleの実行には使用せず、既存のBot内部API secretでBotへ依頼する。

削除OperationはDiscord APIを呼ぶ直前にもHerta設定 / Plugin configからのRole参照を再検証する。予約受付後にBirthday RoleやModeration等の設定が対象Roleを参照した場合も誤削除せず、`DiscordRoleStillReferencedByHertaConfig`としてfailed + Audit Logへ記録する。

Discord Role作成成功後にoperation成功確定・TTL delete生成・Audit Log保存を行うDB transactionが失敗した場合は、作成済みRoleをBot経由で補償削除する。補償削除まで失敗した場合は、実際に作成されたDiscord Role IDとfailure contextをfailed operationとAudit Logへ残し、運用から追跡できる状態にする。

### Bot

Discord固有のprivileged operationはBotへ閉じ込める。

Role作成は常に以下で開始する。

- permissions: `0`
- colors.primary_color: Studioで指定した単色
- colors.secondary_color: `null`
- colors.tertiary_color: `null`
- mentionable: `false`
- hoist: `false`

Role削除ではBot側でも以下を再検証する。

- `@everyone`を削除しない
- Herta OWNER root Roleを削除しない
- Discord Managed Roleを削除しない
- Roleが既に存在しない場合はdeleteを冪等成功として扱う

## Operation state

`discord_role_operations.status`:

- `pending`: 実行待ち
- `processing`: Workerがclaim済み
- `succeeded`: Discord操作とDB確定が完了
- `failed`: 自動処理を停止した失敗
- `cancelled`: 将来のキャンセル機能用に予約済み

作成操作はDiscord APIへの通信結果が不明な状態で再実行すると同名Roleを重複作成し得るため、曖昧な失敗を自動再試行しない。

削除操作は冪等にできるため、429 / 5xx / network failureを最大5回、指数backoffで再試行する。

## Temporary Role

作成操作に`expires_after_seconds`がある場合、Role作成成功時刻から期限を計算して子delete operationを1件生成する。

- 最短: 60秒
- 最長: 365日
- `parent_operation_id`によりcreateとexpiry deleteを関連付ける
- partial/unique indexで同一Roleへの未完了deleteと同一createへのexpiry delete重複を抑止する

TTLは「予約時刻」ではなく「Discord Roleが実際に作成された時刻」を起点とする。

## Audit

Studio受付時:

- `discord_role.create_requested`
- `discord_role.delete_requested`

Worker実行時:

- `discord_role.created`
- `discord_role.deleted`
- `discord_role.create_failed`
- `discord_role.delete_failed`

Bot Tokenや内部API secretはAudit Logへ保存しない。

## Rule Engine連携

DB repositoryは`source: 'rule-engine'`を受け付けるため、将来のTrigger / Condition / Action RuntimeはRole Managerと同じ操作境界を再利用する。

想定Action:

- `discord.role.create`
- `discord.role.create-temporary`
- `discord.role.delete`

Activity Rulesは現時点では活動カウント条件の評価であり、任意Action実行Runtimeではない。Trigger Runtimeが接続されるまでは「特定アクションをしたらRoleを作成」をStudio UIへ表示しない。

## Migration

Migration:

`20260817170500_discord_role_operations_v1`

Prisma schemaへ生成modelを追加せず、既存Birthday Role実装と同様に型付きraw query repositoryを使用する。これにより既存生成Clientへの不要なschema churnを避ける。

## Environment

既存secretを再利用する。

```env
BOT_HEALTH_URL=http://bot:3000/healthz
BOT_INTERNAL_API_SECRET=...
DISCORD_ROLE_OPERATION_SCAN_INTERVAL_SECONDS=15
```

新しいsecretは追加しない。

本番ComposeではWorkerを以下の完了後に起動する。

1. PostgreSQL healthy
2. Redis healthy
3. Prisma migration completed
4. Bot healthy

新しいoperation tableが存在しない状態やBot内部APIが起動前の状態でWorkerがRole処理を開始しないためである。
