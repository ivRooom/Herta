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
