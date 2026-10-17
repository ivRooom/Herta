# Herta Repository Agent Rules

- Source of TruthはこのRepositoryの最新 `main`、Issue、PR、CI、`README.md`、`docs/`。過去のチャットや古いデプロイ状態で固定しない。
- Herta固有のAgent Skillsは [`.agents/skills/README.md`](.agents/skills/README.md)。共通の変更管理・Incident・MCP/Plugin利用は [ivrm-platform Agent Skills](https://github.com/ivRooom/ivrm-platform/tree/main/.agents/skills) に従う。
- Producer/Consumerの契約、Guild境界、静的Plugin Registry、Prisma migrationのimmutable historyを尊重する。
- Secrets/Token/private key/production connection stringをcommit、Issue、PR、ログへ記載しない。
- 本番deploy、DB DDL/bulk write、Discord Botの重大な権限変更、IAM/DNS/Secret変更は対象操作への明示承認が必要。
- 変更に応じて `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` を選び、実施済み/未実施を記録。CI・review・mergeabilityを確認。
- 既存README/RunbookとSkillが異なる場合はRepository内の実装と安全な制約を優先し、矛盾はIssueへ記録する。
