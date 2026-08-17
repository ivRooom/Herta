# Herta Access Control

Herta Studio の Access Control は、AWS IAM に近い **Policy と Principal の分離**を採用します。

Role ごとに Policy JSON を複製するのではなく、Policy を独立したリソースとして作成し、Discord Role、Discord User、Herta Group へ Attach します。

## Concepts

### Policy

Policy は Studio 上の権限を定義する独立リソースです。

- GUI と JSON は同じ Policy document を編集します。
- `Allow` / `Deny`、Action、Resource、Wildcard は既存 Policy Engine の semantics を使用します。
- Policy は複数の Principal から再利用できます。
- Policy 名は Guild 内で大文字小文字を区別せず一意です。
- 保存済み Policy は認可時にも再検証し、不正な document は fail closed で扱います。

### Principal

Managed Policy の Attach 先は次の 3 種類です。

- `role`: Discord Role
- `user`: Discord User
- `group`: Herta Group

OWNER root Role は Herta の trust anchor であり、Managed Policy の Attach 対象にはできません。

### Herta Group

Herta Group は Discord Role とは独立した Herta 内部の権限グループです。

User を Group に所属させ、Group に Policy を Attachすることで、Discord Role 構成を変更せずに Herta Studio の権限をまとめて管理できます。

## Effective access

通常ユーザーの実効権限は、対象 Guild で現在有効な以下の Policy をまとめて評価します。

1. User に直接 Attach された Managed Policy
2. User が現在持つ Discord Role に Attach された Managed Policy
3. User が所属する Herta Group に Attach された Managed Policy
4. 移行期間中の Legacy Role Policy

すべての経路を同じ Policy Engine へ渡し、次の優先順位で評価します。

```text
Explicit Deny > Allow > Default Deny
```

ある Group で Allow されていても、別の Role または Direct User Policy で明示的に Deny されていれば拒否されます。

OWNER root Role は既存仕様どおり trust anchor として扱います。

## Guild boundary

Access Control の全データは Guild scope で扱います。

- Policy CRUD は `guildId` で scope します。
- Group CRUD / membership は `guildId` で scope します。
- Policy Attachment は Policy と同じ Guild に限定します。
- Attach 時は Role / User / Group が対象 Guild に現在存在することを server-side で再検証します。
- Detach は Guild 退出済み User などの stale attachment を削除できるよう、存在確認を必須にしません。
- Group / Policy UUID は API 境界で canonical lowercase に正規化します。

DB でも Policy Attachment と Group Member の複合 FK に `guild_id` を含め、別 Guild の親レコードへ接続できないようにします。

## Mutation authorization

v1 の Access Control mutation は OWNER root Role のみ実行できます。

対象 API では次を server-side で強制します。

- Auth.js session
- Same-Origin mutation check
- OWNER root Role authorization
- bounded request body
- UUID / Discord snowflake validation
- Policy schema / Guild Resource validation
- Principal existence / Guild boundary validation
- Audit Log

UI の disabled / hidden 状態は UX 補助であり、authorization の境界には使用しません。

## Managed Policy names

Studio の事前チェックと DB constraint の semantics を合わせるため、Policy / Group 名は Guild 内で case-insensitive unique とします。

並行リクエストによる競合は PostgreSQL の unique index を正本にし、raw Prisma query の `P2010` + PostgreSQL `23505` かつ対象 name constraint の場合だけ `409 Conflict` として返します。

DB 接続障害や timeout は name conflict と誤分類せず 5xx にします。

## Policy concurrency

Managed Policy は `revision` を持ちます。更新時に Client が保持している `expectedRevision` を送信し、DB の `UPDATE` 条件でも現在 revision と一致することを確認します。

別の管理者または別タブが先に Policy を更新した場合は `409 Conflict` とし、古い document で新しい権限設定を silent overwrite しません。

## Editor safety

Managed Policy Editor は不正な JSON / Policy document を GUI の空 Policy として扱いません。

- 不正 document では GUI action controls を無効化します。
- JSON draft は修正されるまで保持します。
- Attachment 更新による `router.refresh()` で未保存 Policy 編集を上書きしません。
- Group Member 更新でも未保存 Group 名 / 説明を保持します。

## Legacy Role Policy

既存 Guild の権限を突然変更しないため、`GuildSettings.settings_json.studioAccess.rolePolicies` は v1 migration では削除・自動変換しません。

Legacy Role Policy は移行期間中、認可の互換入力として **読み取り・評価のみ** 継続します。

`/api/guilds/[guildId]/role-policies` は GET-only とし、旧 Role Policy の PUT / DELETE 書き込み経路は閉じます。旧 Plugin Permission Matrix URL も Access Control Center へリダイレクトし、Legacy Role JSON を更新する Client Editor は削除します。

既存データに保存済みの Plugin scoped statement も認可入力としては引き続き評価しますが、新規・変更する Plugin Resource 権限は Managed Policy document で定義します。v1 では JSON Editor から任意 Resource を記述でき、Plugin 項目向けの専用 Visual Resource Builder は後続フェーズで追加します。

Legacy Policy の完全廃止は migration wizard と利用状況確認を行う別フェーズで実施します。

## Discord Role lifecycle integration

Managed Policy が Attach されている Discord Role は Herta 設定から参照中の Role として扱います。

Role Lifecycle から Discord Role を削除する際は、Managed Policy Attachment を含む Herta 側参照を検証し、dangling reference を作らないよう削除を拒否します。

## Audit events

主な security-sensitive mutation は Audit Log へ記録します。

- `studio_access_policy.created`
- `studio_access_policy.updated`
- `studio_access_policy.deleted`
- `studio_access_policy.attached`
- `studio_access_policy.detached`
- `studio_access_group.created`
- `studio_access_group.updated`
- `studio_access_group.deleted`
- `studio_access_group.member_added`
- `studio_access_group.member_removed`

Policy document 全文は Audit Log へ複製せず、Policy ID、名前、revision、Principal など運用に必要な metadata を中心に保存します。

mutation が DB 上で完了した後に Audit Log の書き込みだけ失敗した場合は、既に成功した操作を Client へ 500 と誤通知して再実行を誘発しないよう、structured error log を残した上で mutation 自体の成功レスポンスを維持します。

## Database migration

v1 migration:

```text
packages/db/prisma/migrations/20260817203000_studio_managed_access_policies_v1/
```

追加テーブル:

- `studio_access_policies`
- `studio_access_groups`
- `studio_access_group_members`
- `studio_access_policy_attachments`

新しい環境変数、Discord Developer Portal 設定、command sync は不要です。

## Next phases

v1 後は次を独立した変更として追加します。

1. Legacy Role Policy → Managed Policy migration wizard
2. User 一覧 / Effective Access Viewer
3. Policy Simulator と Allow / Deny source 表示
4. Policy revision history / diff / rollback
5. Plugin field / operation Resource の Managed Policy Visual Builder
