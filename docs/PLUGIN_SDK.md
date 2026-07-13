# Plugin SDK

Plugin SDK は、Herta に静的に組み込む Plugin のインターフェースを提供します。
外部から Plugin をインストールしたり、設定値をコードとして実行したりする仕組みでは
ありません。Plugin 実装は TypeScript の依存パッケージとして管理し、Runtime Registry に
明示的に登録します。

## Plugin の作成

`HertaPlugin<TConfig>` を `definePlugin()` に渡して Plugin を定義します。

```ts
import { definePlugin } from '@herta/plugin-sdk';

interface Config {
  greeting: string;
}

export const plugin = definePlugin<Config>({
  manifest,
  async onEnable(context) {
    context.logger.info({ guildId: context.guildId }, '有効化しました');
  },
  async onDisable(context) {
    context.logger.info({ guildId: context.guildId }, '無効化しました');
  },
});
```

## Interface 仕様

必須項目は `manifest` です。`manifest.id` は kebab-case の一意な ID とし、manifest の
`commands` と `events` には Plugin が提供する名前を宣言します。Runtime は起動時に
manifest、Hook、Command 名を検証し、不正な Plugin を警告してスキップします。

利用可能な Hook は以下です。

- `onLoad(context)`: システムへのロード時
- `onEnable(context)`: Guild で有効化された時
- `onDisable(context)`: Guild で無効化された時
- `onUnload()`: システムからアンロードされた時
- `onConfigChange(context, oldConfig, newConfig)`: 設定変更時

## Command の追加

`provideCommands(context)` から `CommandHandler[]` を返します。Command 定義は
manifest にも記載してください。

```ts
provideCommands(context) {
  return [{
    definition: { name: 'sample-ping', description: '応答を確認します' },
    async execute(interaction) {
      await interaction.reply(context.config.greeting);
    },
  }];
}
```

Command は Guild ごとに生成され、Core Command や他 Plugin と名前が重複する場合は
その Plugin 全体がスキップされます。

## Event の追加

`provideEvents(context)` から `{ event, handler }` を返します。Handler の第 1 引数は
実行コンテキストで、残りの引数は Discord イベントの引数です。

```ts
provideEvents() {
  return [{
    event: 'messageCreate',
    async handler(context, message) {
      context.logger.debug({ guildId: context.guildId, messageId: message.id }, '受信');
    },
  }];
}
```

## Config と Runtime Context

`PluginRuntimeContext<TConfig>` は次の値を持ちます。

- `client`: Discord Client（型引数で具体化）
- `prisma`: PrismaClient（型引数で具体化）
- `logger`: `pluginId` と `guildId` が bind された Pino child logger
- `guildId`: 対象 Guild ID
- `config`: Guild 固有の `TConfig`
- `manifest`: 実行中 Plugin の manifest

設定は `manifest.configSchema` に対応する型を `TConfig` として定義します。設定値は
データとしてのみ扱われ、動的 import、`eval`、外部 Plugin のインストールには利用されません。

## Runtime Registry への接続

Bot 側で静的に `toRuntimePluginEntry(plugin, createContext)` を呼び、Registry に登録します。
`createContext` は Bot の Discord Client、PrismaClient、Logger を
`createPluginContext()` に渡して Guild ごとの Context を作成します。`examples/sample-plugin`
に Command、Event、設定、Lifecycle を含む完全な例がありますが、公式 Catalog には登録されて
いません。
