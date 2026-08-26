# Database Migration Policy / Incident Runbook

Herta の Prisma / PostgreSQL migration を安全に運用するための規約です。

## Production migration immutability

production へ適用済みの `packages/db/prisma/migrations/*/migration.sql` は書き換えません。

Prisma は適用済み migration の履歴と checksum を前提にするため、障害復旧後であっても既存 migration の内容変更で帳尻を合わせないでください。修正が必要な場合は新しい migration を追加します。

## `CREATE INDEX CONCURRENTLY` policy

新規 migration は次を守ります。

- `CREATE INDEX CONCURRENTLY` を含む migration は、**そのindex文だけのsingle-statement migration**にする
- 同一 `migration.sql` に2本以上の concurrent index を入れない
- concurrent index と `ALTER TABLE` / `ANALYZE` / `SET` 等の別の実行SQLを同居させない
- SQL comment / quoted literal / dollar string 内の文字列は実行文として数えない
- dollar-quote tagはunquoted identifier中の `$tag$` と区別する
- string literalのbackslash解釈差でguardを迂回できないよう、CI scannerは `standard_conforming_strings` の両解釈を保守的に検査する
- 新規SQLでbackslash escapeが必要な文字列は、挙動を明示できる `E'...'` を優先する
- CI の `packages/db/src/migration-policy.test.ts` を無効化・緩和して通さない

`20260825022000_suggestion_staff_queue_index` は 2026-08-25 の production incident で既に適用履歴へ入った historical exception です。checksum/history を守るため、そのSQL全体を SHA-256 で固定し、新しい例外の追加は認めません。

## 2026-08-25 incident

1つの Prisma migration に複数の `CREATE INDEX CONCURRENTLY` を含めたことで、PostgreSQL `25001` / Prisma `P3009` が発生しました。

復旧時には、failed migration が実際に何 step 実行されたかと対象 index の有無を先に確認し、0 step / index未作成であることを確認した上で、必要な index を個別に `CONCURRENTLY` 作成し、Prisma migration history を整合させてから後続 migration を適用しました。最後に migrator の正常終了と index の `indisvalid=true` / `indisready=true` を確認しました。

## Failure recovery rules

production で migration が失敗した場合は、次の順序を崩しません。

1. **自動再実行しない。** まず Prisma error code、PostgreSQL error、failed migration 名を記録する。
2. **DBの実状態を確認する。** migration history、対象table/index、部分適用の有無を確認する。
3. **適用済みSQLを書き換えない。** checksum/history保護を優先する。
4. **復旧操作を最小化する。** 必要なSQLだけを個別に実施し、二重作成やpartial stateを避ける。
5. **Prisma historyを実DBと一致させる。** `migrate resolve` 等は、実際のDB状態を確認した後にのみ使う。
6. **後続 migration を再開する。** `migrate deploy` の正常終了を確認する。
7. **post-checkを行う。** index validity/readiness、application health、migrator exit statusを確認する。
8. **再発防止をCIへ入れる。** incident固有の例外追加ではなく、将来の新規migrationを拒否するpolicy testを優先する。

## New migration review checklist

- migration は既存production migrationを書き換えていない
- destructive DDL / long lock / table rewrite の影響を確認した
- `CREATE INDEX CONCURRENTLY` を含む場合、その文だけのsingle-statement migrationになっている
- concurrent indexを複数本作る場合はmigration自体を分割した
- index / unique / FK がexisting dataと互換である
- rollbackが必要な場合のforward-fixまたはrestore方針が明確
- `pnpm db:generate`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- repositoryのproduction Compose / Docker / SBOM / Grype gateがGREEN

このRunbookは復旧手順を自動実行するものではありません。production migration、`migrate resolve`、手動DDLは必ず実DB状態を確認した別フェーズで実施します。
