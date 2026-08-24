# Plugin Runtime Loader

## 概要

Plugin Runtime Loader は、Guild ごとに Plugin Manager で有効化された公式 Plugin の設定を
読み込み、静的に登録された Runtime provider から Command と Event handler を組み立てます。
Catalog が持つ manifest と DB の設定を入力とし、Guild ごとに独立した Runtime を構築します。

## Registry への登録

`apps/bot/src/plugins/registry.ts` の `defaultPluginRegistry` は静的な
`RuntimePluginEntry` の集合です。新しい公式 Plugin は catalog manifest を追加したうえで、
Registry の静的 entries に `pluginId` を追加します。provider は通常の TypeScript import
として静的に実装し、DB 設定からモジュールを選択することはありません。

## Command / Event の提供

Entry に `provideCommands(config)` または `provideEvents(config)` を実装します。Provider は
Guild の設定を受け取り、その Guild で利用する `SlashCommand[]` または
`GuildEventHandler[]` を返します。Command 名が Core Command または先にロードされた Plugin
と衝突した場合、その Plugin 全体が無効になります。

## Cache と即時 invalidate

設定取得結果は `InMemoryGuildPluginCache` に Guild ID 単位で保存され、既定では 60 秒で期限切れ
になります。StudioでPluginのON/OFFまたは設定更新がDBへcommitされた後、
`herta:plugin-runtime:v1` チャンネルへ次の情報だけを通知します。

- `schemaVersion`
- `eventId`
- `guildId`
- `pluginId`
- `configVersion`
- `eventType`
- `occurredAt`

Plugin設定本体、Token、SecretはPub/Subへ流しません。Botは通知を受けると対象Guildだけを
直列化・debounceし、既存Runtimeの`onDisable`、cache invalidate、DB再取得、`onEnable`、
Guild Command同期を順に実行します。同一イベントと古いversionは破棄し、1 Guildの同期失敗を
他GuildやBot全体へ波及させません。

Redis切断中はioredisの再接続を利用します。通知は永続化されないため、切断中に失われた更新は
Bot起動時の全Guild同期と60秒TTLによる実行時再取得で回復します。Redisが利用できない場合も
Core CommandとTTL同期を維持し、Bot全体は停止しません。

## Consumer別 apply ACK

Runtime apply監査のmetadataには`consumer`を記録します。既知consumerはshared契約で管理し、
現在実際にRuntime eventを購読してapply ACKを生成するconsumerは`bot`です。

- 通常のBot反映: `operationSource=bot-runtime`, `consumer=bot`
- Bot起動時の復旧ACK: `operationSource=bot-runtime-startup-recovery`, `consumer=bot`

`consumer`が存在しない既存Audit rowは後方互換のため`bot`として解釈します。未知consumerの
apply ACKは安全側に無視し、Botの反映状態を誤って上書きしません。StudioのRuntime状態集計は
consumerごとのkeyを持つため、将来WorkerがRuntime consumerになった場合もBot/Workerの成功・失敗を
独立して扱えます。

Workerは現時点では`herta:plugin-runtime:v1`を購読していないため、`consumer=worker`のACKを
生成しません。実際の購読・適用確認が実装されるまでWorker成功を推測して記録しないことを契約とします。

## Expected Runtime consumers

Pluginごとに必要なRuntime apply ACKは、Plugin Manifestの`expectedRuntimeConsumers`をSource of
Truthとして定義します。値はsharedの`PluginRuntimeConsumer` allowlistだけを受け付けます。
Studio専用mappingやPlugin ID switchは持ちません。

```ts
expectedRuntimeConsumers?: PluginRuntimeConsumer[];
```

既存Pluginとの後方互換のため、property未指定・空配列・解決可能な既知consumerがない場合は
`resolveExpectedRuntimeConsumers()`が`['bot']`へ解決します。このため既存Pluginが突然Worker ACKを
待つことはありません。重複指定はresolverで除去します。

Operations Centerは既知consumerごとに次の状態を組み立てます。

- `Applied`: expected consumerのapply ACK成功
- `Failed`: expected consumerのapply ACK失敗
- `Pending`: publish成功後、expected consumerのACK待ち
- `No signal`: 現在のconfigVersionにconsumerのRuntime signalがない
- `Not expected`: Manifest上quorumに含まれないconsumer

Runtime publishはproducer側の共通配送結果でありconsumer別イベントではありません。そのため
publish失敗はexpected consumerに関係なくAttentionです。一方、apply失敗とACK遅延は
`expected=true`のconsumerだけを対象にします。publish後2分未満のPendingは即Attentionにせず、
2分以上ACKがない場合にAttentionへ移行します。Not expectedなconsumerのACKや未知consumerのACKは
quorumを満たしたり壊したりしません。

AuditLogは既存の一括queryを使用し、取得済みrowからconsumer別state mapをin-memoryで構築します。
Plugin × consumerの追加DB queryは発行しません。DB migrationやGuildごとのexpected consumer設定も
不要です。

Workerを`expectedRuntimeConsumers`へ追加するのは、対象PluginについてWorker側のRuntime event購読・
設定反映・ACK生成が実装されてからです。現時点では既存PluginをWorker requiredにしません。

## Worker Runtime consumer requirement discovery

2026-08-24時点のWorker実装を確認した結果、現行PluginにはWorker process内へGuild Plugin設定を
長期保持してRuntime eventで再適用すべき対象がありません。そのため、Worker subscriber、
`consumer=worker` ACK、Worker startup reconciliationはまだ導入しません。

- Daily Content: due判定、stale recovery、配信実行時にDBからenabled/configを再取得し、process内のPlugin設定stateは持ちません。ただし`maxAttempts`だけはenqueue時にBullMQ `job.opts.attempts`へsnapshotされ、既存waiting / active / delayed jobは旧retry budgetを保持します。このdurable queue stateの整合は #318 で別途扱います。
- LFG: expire、message同期、recoveryではenabledを通常scanごとにDB確認します。`retentionDays`はhourly pruneでconfigをDB取得するため、enabled変更は次回通常scan、retention変更は次回prune cycleで反映されます。process内のPlugin設定stateは持ちません。
- Team Split: 各通常scanでenabled Guildを一括取得します。`retentionDays`はhourly pruneでconfigをDB取得するため、enabled変更は次回通常scan、retention変更は次回prune cycleで反映されます。process内のPlugin設定stateは持ちません。
- Community Season Snapshot: `GuildPlugin`設定を参照しないbackground maintenanceのためPlugin Runtime対象外です。
- Discord Role Operation: 永続化済みoperationをDBからclaimして実行するためPlugin Runtime対象外です。

Daily Contentが持つDiscord permission cacheはDiscord権限情報の短期cacheであり、Guild Plugin configの
Runtime stateではありません。また、Plugin無効化後に既存deliveryが残っていても、配信実行直前に
`GuildPlugin.enabled`を再確認してskipします。再有効化後は定期scanの`initializeMissingNextRuns()`が
現在のDB状態から`nextRunAt`を再構築します。

一方、`maxAttempts`はqueue job生成時のtransport optionへコピーされるため、既存jobについてはDB再読込だけで
現在値へ収束しません。これはWorker process内Runtimeを再構築する問題とは分離し、queue retry policyとして
#318で修正します。現時点でこの差分だけを根拠にWorker apply ACKを生成すると、実際にqueue stateを
更新していないのにAppliedと記録できてしまうため、Worker consumer化は行いません。

LFGとTeam SplitもWorker起動時にPlugin別timerを動的登録しておらず、Worker process自体は常時起動した
まま現在のDB状態から処理対象を決めます。enabledは次回通常scan、`retentionDays`は最大約1時間後の
次回prune cycleで再取得されます。Redis Pub/Sub停止中に変更があっても、それぞれのpolling cycleで
現在のDB状態へ収束します。

この構成でWorker ACKだけを追加すると、実際には再適用するWorker process stateが存在しないにもかかわらず
Operations上でWorker apply成功を表現することになります。したがって現行Manifestは引き続きdefault
`['bot']`を使用し、Daily Content / LFG / Team Splitへ機械的に`worker`を追加しません。

WorkerをRuntime consumer化するのは、対象Pluginが次のいずれかを持つようになった場合です。

- Guild Plugin configをWorker process内へscan間隔を超えて保持する
- configに基づくtimer、scheduler、job registrationをWorker内へ動的に保持する
- enable / disableを通常scanより速く即時反映する必要がある
- job実行時にDBを再取得せず、Worker process内stateを正として処理する

その場合はManifestだけを先行変更せず、既存`herta:plugin-runtime:v1` contractを再利用したsubscriber、
stale / duplicate protection、対象Pluginだけのapply、`consumer=worker`成功/失敗ACK、Pub/Sub取りこぼしを
回復するstartup reconciliationを同一変更として実装してから`expectedRuntimeConsumers`へWorkerを追加します。

## エラー分離

DB の取得障害は空の Plugin 一覧として扱い、Core Command のみで Bot を継続します。未登録
Plugin、provider の例外、Command 名の重複は当該 Plugin だけをスキップし、構造化ログへ
`guildId`、`pluginId`、`commandName`、`error` を記録します。

Pub/Subの不正payload、未知のschema version、重複イベント、古いイベントは破棄します。
Publisher障害はDB更新をロールバックせず、TTL経由の整合性回復へフォールバックします。

## セキュリティ設計

設定値はデータとしてのみ扱い、コードとして評価しません。Runtime Registry は静的なコード
のみを参照し、`eval`、動的 `import()`、外部 Plugin のインストールや Marketplace は使用
しません。そのため、Guild 管理者が保存した設定によって任意のモジュールやコードが実行される
ことはありません。
