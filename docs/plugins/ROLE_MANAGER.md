# Role Manager

Role Managerは、Guild管理者が許可したDiscord Roleだけをメンバー自身で付与・解除できる公式Pluginです。

## v1機能

- `/role list` — 選択可能なSelf Role一覧を表示
- `/role add role:<Role>` — Self Roleを追加
- `/role remove role:<Role>` — Self Roleを解除
- `/role toggle role:<Role>` — 現在の状態に応じて追加・解除
- `single`グループ — 同じグループから常に1Roleだけ保持
- `multiple`グループ — `maxSelections`まで複数Roleを保持
- Config StudioのDiscord Role Pickerで選択
- 実行時Role hierarchy再検証
- Managed Roleと`@everyone`相当Roleの操作拒否

## Discord権限

Herta Botには`Manage Roles`（ロールの管理）が必要です。

Role ManagerはBotより上位または同順位のRoleを編集できません。Self Roleとして使用するRoleは、Discordのサーバー設定でHerta BotのRoleより下へ配置してください。

Studioの既定Guild Install権限にも`Manage Roles`を含めています。既存環境で`DISCORD_BOT_PERMISSIONS`を独自指定している場合は、その値にも`Manage Roles`を追加してください。

## 設定

Role Managerは通常のPlugin設定画面からConfig Studioで編集します。

```json
{
  "enabled": true,
  "ephemeralResponses": true,
  "allowSelfRemoval": true,
  "groups": [
    {
      "enabled": true,
      "id": "platform",
      "name": "プレイ環境",
      "description": "普段利用する環境を1つ選択します",
      "mode": "single",
      "maxSelections": 1,
      "roleIds": ["123456789012345678", "234567890123456789"]
    },
    {
      "enabled": true,
      "id": "games",
      "name": "ゲーム通知",
      "description": null,
      "mode": "multiple",
      "maxSelections": 3,
      "roleIds": ["345678901234567890", "456789012345678901"]
    }
  ]
}
```

### Roleグループ

`single`は新しいRoleを追加したとき、同じグループで現在保持している別Roleを自動解除してから新Roleへ切り替えます。

`multiple`は`maxSelections`まで同時に保持できます。上限到達後の追加は拒否します。

同一Roleを複数グループに登録した場合、Runtime正規化では先に確定したグループだけを採用し、重複を除去します。運用上は1Roleを1グループだけへ登録してください。

## 安全性

Role Managerはユーザーが指定した任意Roleを操作しません。Config Studioで明示的にallowlistへ登録されたRoleだけを対象にします。

実際のRole変更直前に次を再確認します。

1. 対象Roleが設定済みallowlistに含まれる
2. Botが`Manage Roles`を持つ
3. Discord上にRoleが存在する
4. Managed Roleではない
5. BotのRole hierarchy上で編集可能である

`single`グループで複数Roleを切り替える場合も、追加・解除対象をすべて事前検証してから変更します。

## データ・外部API

- Prisma migrationなし
- 新規テーブルなし
- Role Manager専用Secretなし
- OpenAI APIを含む有料AI API呼び出しなし
- Role状態はDiscordを正本とし、Herta DBへ複製しない

## 実Guild QA

1. Herta Botへ`Manage Roles`を付与する
2. テスト用RoleをHerta Botより下へ配置する
3. StudioでRole Managerを有効化する
4. `single`グループを作り、Roleを2個以上登録する
5. `/role add`で1Role目を付与する
6. 別Roleを`/role add`し、1Role目が解除されることを確認する
7. `multiple`グループで最大選択数まで追加できることを確認する
8. 上限超過が拒否されることを確認する
9. `/role toggle`で付与・解除を確認する
10. Botより上へテストRoleを移動し、操作が安全に拒否されることを確認する
11. Managed Roleを操作できないことを確認する

## 次Phase

Role ManagerのRole操作基盤を利用して、次にBirthday Roleを追加します。

- ユーザー自身の誕生日登録
- 月日のみ保存するプライバシー配慮設定
- 当日Birthday Role自動付与
- 翌日自動解除
- 誕生日通知Channel
- タイムゾーン対応
- Studioでの有効化・Role/Channel選択

Birthday機能もOpenAI APIには依存しません。
