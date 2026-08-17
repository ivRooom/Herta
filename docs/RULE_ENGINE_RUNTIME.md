# Rule Engine Production Runtime v1

Herta Rule Engine の production runtime v1 は、`schedule.minute` を最初の実運用 Trigger として Bot process へ接続し、Rule Action から Discord API を直接呼ばずに Discord Role Lifecycle Operation を生成します。

## Runtime flow

```text
Bot schedule scanner (30s)
  -> UTC minute execution ID
  -> enabled Rules for guild / schedule.minute
  -> RuleEvaluator
  -> Condition
  -> live root authorization
  -> atomic cooldown / maxExecutions claim
  -> Role Lifecycle Action
  -> discord_role_operations (source=rule-engine)
  -> Worker
  -> Bot internal role mutation boundary
  -> Discord
```

同じminuteはprocess内で1回だけ評価します。process再起動や複数配送が発生しても、Rule Execution Logの`executionId`とRole create Operationのdeterministic IDで重複作成を抑止します。

## Trigger

### `schedule.minute`

設定:

```json
{
  "type": "schedule.minute",
  "config": {
    "everyMinutes": 60,
    "offsetMinutes": 0
  }
}
```

- `everyMinutes`: 1〜1440
- `offsetMinutes`: 0〜`everyMinutes - 1`
- 判定基準はUTC epoch minute
- execution ID: `schedule-minute:<epoch-minute>`

## Condition

### `schedule.utc-hour-is`

```json
{
  "type": "schedule.utc-hour-is",
  "config": { "hour": 12 }
}
```

`hour` は 0〜23 です。複数Conditionや`and` / `or` / `not`は既存Rule Engine semanticsを使用します。

## Role Lifecycle Actions

### `discord.role.create`

```json
{
  "type": "discord.role.create",
  "config": {
    "roleName": "Event Role",
    "roleColor": 5793266
  }
}
```

### `discord.role.create-temporary`

```json
{
  "type": "discord.role.create-temporary",
  "config": {
    "roleName": "Temporary Event Role",
    "roleColor": 5793266,
    "expiresAfterSeconds": 86400
  }
}
```

`expiresAfterSeconds` は 60〜31536000 秒です。期限切れ削除は既存Workerが `temporary-expiry` Operationとして処理します。

### `discord.role.delete`

```json
{
  "type": "discord.role.delete",
  "config": {
    "roleId": "123456789012345678"
  }
}
```

削除対象は現在のGuildに存在し、Botから見てeditableで、Herta root Roleではないことをlive Discord stateで再検証します。その後もWorker側のHerta reference protectionとBot role hierarchy validationを通ります。

## Security boundary

Role Action実行前に以下をserver-sideで再検証します。

1. Ruleの`created_by`が現在も対象Guildの `HERTA_STUDIO_ROOT_DISCORD_ROLE_ID` を保持していること
2. Role作成時にBotがManage Rolesを保持していること
3. Role削除時に対象Roleが同一Guildに存在し、editableかつmanagedではなく、root Roleではないこと
4. Ruleの`guild_id`と生成するRole Operationの`guild_id`が同一であること

Rule EngineにはBot Tokenを渡しません。Discordのprivileged mutationは既存Worker -> Bot internal API境界のみで実行します。

## Idempotency

Role create / temporary create のOperation IDは以下からdeterministicに生成します。

```text
ruleId + triggerExecutionId + actionIndex
```

Action payloadは別のSHA-256 fingerprintへ束縛します。

- 同一trigger executionの再配送 + 同一payload: 既存Operationを再利用
- 同一idempotency key + 異なるpayload: `DiscordRoleOperationIdempotencyConflictError`

create結果が不明な場合にWorkerが自動retryしない既存Role Lifecycle方針も維持します。

## Cooldown / max executions

Condition成立後、Action直前にRule rowを `FOR UPDATE` でlockしてclaimします。

- disabledへ変更済み: skip
- 同一`triggerExecutionId`のExecution Logが存在: duplicate skip
- `execution_count >= max_executions`: skip
- 直近Action実行から`cooldown_ms`未満: skip

claim成功時だけ`execution_count`をincrementします。

## Observability

`rule_execution_logs`へ以下を保存します。

- trigger type / execution ID
- conditions result
- actions executed
- action skip reason
- Action結果（Operation ID / status）
- error
- duration

Discord message content、Bot Token、Secretは保存しません。

Studioの **Role Manager > Rule Engine 実行履歴** から直近30件をGuild scopeで確認できます。

## v1 scope

v1は安全にproductionへ接続する最小縦切りとして`schedule.minute`のみをproduction Triggerにしています。Message / reaction / voice / achievement / moderation / webhook TriggerやRule編集UIは後続フェーズです。Triggerを追加するときもstable execution IDを必須にし、同じRuntime Store / Action boundaryを再利用します。
