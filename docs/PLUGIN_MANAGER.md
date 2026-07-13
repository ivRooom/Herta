# Plugin Manager

Plugin Manager は、Guild 単位で Herta Plugin の有効化と設定を管理する基盤です。

## 構成

- `@herta/plugin-catalog`: 6 つの公式 Plugin の `PluginManifest` を集約するカタログ
- `getEnabledPlugins(prisma, guildId)`: Bot の将来の Loader が利用する有効 Plugin の問い合わせ API
- Studio API: Discord の Administrator または Manage Guild 権限を検証してから Guild Plugin を更新
- Prisma: `Plugin`、`GuildPlugin`、`GuildPluginConfigHistory`、`AuditLog` を利用

カタログの manifest 以外から Plugin を動的にロードしたり、設定値を実行したりすることはありません。

## API

### `GET /api/guilds/:guildId/plugins`

カタログに存在する全 Plugin を返します。Guild に設定行がない場合は `enabled: false`、`config: {}` として返します。

### `GET /api/guilds/:guildId/plugins/:pluginId`

Plugin manifest、`enabled`、現在の `config`、`configSchema` を返します。未知の ID は 404 です。

### `PATCH /api/guilds/:guildId/plugins/:pluginId`

```json
{
  "enabled": true,
  "config": {
    "maxResponses": 50
  }
}
```

`config` は manifest の JSON Schema を Ajv で検証します。不正な値は 400 です。設定変更時は `configVersion` を増加させ、履歴と監査ログを同一トランザクションで保存します。有効化・無効化も `plugin.enable` / `plugin.disable` として監査ログに記録されます。

## 将来の Loader

Bot の Command/Event Loader は `getEnabledPlugins(prisma, guildId)` を呼び出し、返された manifest と設定を使います。Plugin 実装の import は Loader 側で静的に管理し、DB の値をコードとして評価しません。
