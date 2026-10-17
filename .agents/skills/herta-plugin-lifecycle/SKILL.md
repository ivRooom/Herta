---
name: herta-plugin-lifecycle
description: HertaのGuildごとのPlugin追加・有効化・設定変更・Bot Runtime同期・障害調査に使う。Guild権限・監査・queue・MCPの安全な境界を保つ。
---

# Herta Plugin Lifecycle

## 正本と前提

- 最新 `README.md`、`docs/PLUGIN_MANAGER.md`、`docs/PLUGIN_RUNTIME.md`、`docs/PLUGIN_SDK.md`、`apps/bot/src/plugins/registry.ts`、関係するIssue/PR/CIから実装を確認する。
- 共通の [task-router](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/task-router/SKILL.md)、[tool-access-and-mcp](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/tool-access-and-mcp/SKILL.md)、[discord-bot-operations](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/discord-bot-operations/SKILL.md) を併用。
- Herta内部の「Plugin」は、ChatGPT Plugin/MCP connectorとは**別物**。Runtime設定管理と外部Tool接続を混同しない。

## 実装・調査手順

1. 対象Guild、Plugin ID、認可条件、Catalog Manifest、config schema、既存Runtime Command/Event、設定versionを洗い出す。Guild識別子や個人情報はPRへ貼らない。
2. Studio APIの権限判定（Administrator/Manage Guild）、Ajv schema validation、Prisma transactionでのConfigHistory/AuditLog永続化を確認する。
3. Runtime providerは静的Registryへ明示登録。DB値をコード評価・任意importしない。Command名とCore commandの衝突、他Pluginとの競合を検証。
4. `herta:plugin-runtime:v1` の通知はID/version等だけ。Token/config本文をPub/Subへ流さない。BotのGuild単位invalidate/reload/Command同期とTTL補完をテスト。
5. `expectedRuntimeConsumers` はManifestを正本とし、Workerが実際にsubscriber/apply ACKを実装するまでは機械的に `worker` を要求しない。Publish結果とconsumer別Ack/遅延を分ける。
6. Worker queue対象ではDB永続状態とBullMQ transport retryを分離し、二重配信・Guild間状態漏れ・rate-limit・再起動後のreconciliationを検討する。
7. 差分から対象packageのunit/integrationを特定し、root `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` とCIの結果を記録する（実行したものだけ合格と記す）。

## MCP/Plugin / Production gate

GitHubで最新Issue/PR/Actions、利用可能なDiscord/Cloud/DBのMCPでread-only診断を優先。接続未確認なら `not-tested` と報告。Bot Token/Client Secretはtool output・Issue・Logに露出させない。

本番Guild設定変更、schema migration、Bot/Worker deploy、Secret rotationは影響Guild・rollback・明示承認を確認する。障害時はCore Command継続、対象Guildのみ影響隔離を優先し、`docs/HEALTH.md` と `docs/STATUS_AGENT.md` の健全性を確認。

## 引継ぎ

対象Plugin/Guild（匿名化）、変更Manifest・Registry、Producer/Consumer、期待ACK、テスト/CI、未反映の接続・承認、rollbackと残件をPRへ記録。
