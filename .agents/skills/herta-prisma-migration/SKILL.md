---
name: herta-prisma-migration
description: HertaのPrisma/PostgreSQL schema変更やmigration failureを調査・計画・復旧する。特に本番の既存migration checksum保護とCREATE INDEX CONCURRENTLY事故防止に使う。
---

# Herta Prisma Migration

## 適用規約

`docs/DATABASE_MIGRATIONS.md` が正本。共通 [data-migration](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/data-migration/SKILL.md)、[incident-response](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/incident-response/SKILL.md)（障害時）、[tool-access-and-mcp](https://github.com/ivRooom/ivrm-platform/blob/main/.agents/skills/tool-access-and-mcp/SKILL.md) を併用する。

## 作業順

1. 実際のDB接続先・環境、現在のPrisma schema、migration history、対象table/index、使用アプリ（API/Bot/Studio/Worker）をread-onlyで確認。
2. 既にProductionに適用された `packages/db/prisma/migrations/*/migration.sql` を**書き換えない**。修正は新規migration。危険なDDLはexpand/migrate/contractと互換窓を設計。
3. `CREATE INDEX CONCURRENTLY` はmigration単位でsingle statement、同一SQLへ他のDDL/ANALYZE/SET等を混在させない。既存 `migration-policy.test.ts` を回避しない。
4. BackupがあってもRestore rehearsal、依存バージョン、table lock、index validity/readiness、rollback/roll-forward可能性を確認。
5. ローカル開発で必要な場合のみ `pnpm db:generate`、開発環境の `pnpm db:migrate` を利用し、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` を実施。
6. ProductionでP3009/25001等を検知したら自動再実行しない。実際のmigration履歴、部分適用されたIndexの有無、PostgreSQLのエラーを確認し、個別の復旧計画をreviewする。
7. Production `migrate deploy`、`migrate resolve`、DDL、手動SQL修復、Data bulk write/deleteは**対象操作を明示した承認後**のみ。専用runbookの実例をそのまま本番で実行しない。
8. 作業後はmigration history、index `indisvalid/indisready`、アプリの主要動作、queue lag/healthを確認する。

## 必須成果

Schema影響・新旧互換・Backup/Restore検証・実行コマンドと結果・事前承認・Failure時の停止判断・rollback/forward-fix・PR/Issueリンク。
