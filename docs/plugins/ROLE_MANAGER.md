# Role Manager

Role Managerは、Guild管理者が許可したDiscord Roleだけをメンバー自身で付与・解除できる公式Pluginです。

## v1機能

- `/role list` — 選択可能なSelf Role一覧を表示
- `/role add role:<Role>` — Self Roleを追加
- `/role remove role:<Role>` — Self Roleを解除
- `/role toggle role:<Role>` — 現在の状態に応じて追加・解除
- `single`グループ — 同じグループから常に1Roleだけ保持
- `multiple`グループ — `maxSelections`まで複数Roleを保持
- Config StudioのDiscord Role PickerでRole名・ID検索と複数選択
- PickerではBotから編集可能なRoleだけを候補化
- 実行時Role hierarchy再検証
- Managed Roleと`@everyone`相当Roleの操作拒否
- 同一メンバーのRole変更を直列化
- Discord REST操作前にInteractionをdeferして応答期限切れを防止

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

`editableOnly`はGuild設定JSONへ保存する値ではなく、Role Pickerを描画するためのManifest Schema metadataです。`roleIds`のSchemaには実際に次の指定があります。

```ts
roleIds: {
  type: 'array',
  items: { type: 'string', pattern: '^\\d+$' },
  'x-herta-ui': {
    widget: 'discord-role',
    multiple: true,
    editableOnly: true,
    placeholder: 'Self Roleとして許可するRoleを検索',
  },
}
```

`widget: 'discord-role'`によってConfig StudioでRole名・Discord ID検索が利用でき、`multiple: true`で複数Roleを選択できます。`editableOnly: true`では、Botから編集可能と判定できるRoleへ候補を絞ります。ただしDiscord側のRole順は後から変化し得るため、保存時のPicker判定だけには依存せず、コマンド実行直前にもRole hierarchyを再検証します。

### Roleグループ

`single`は新しいRoleを追加したとき、同じグループで現在保持している別Roleを新Roleへ置き換えます。切替時は現在の無関係なRoleを維持した最終Role集合を作り、Discordへ1回の更新として適用します。

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

同一Guild・同一メンバーのRole操作はBotプロセス内で直列化し、ロック取得後にGuild Memberを強制再取得してから選択上限と排他条件を再計算します。これにより、同時に複数の`/role add`が実行されても、古いRole状態を基準に両方が許可される競合を防ぎます。

`single`グループで既存Roleから新Roleへ切り替える場合は、追加・解除対象をすべて事前検証した後、無関係なRoleを保持した最終Role集合を1回のDiscord更新で適用します。

Role変更を伴うコマンドでは、Guild Member取得やRole取得より前にDiscord Interactionをdeferします。Role操作がREST遅延の影響を受けても、初回応答期限を超えてInteraction tokenが失効しにくい構成です。

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
4. Role PickerがRole名・IDで検索でき、Botから編集できないRoleを候補から除外することを確認する
5. `single`グループを作り、Roleを2個以上登録する
6. `/role add`で1Role目を付与する
7. 別Roleを`/role add`し、1Role目から2Role目へ切り替わることを確認する
8. `multiple`グループで最大選択数まで追加できることを確認する
9. 上限超過が拒否されることを確認する
10. `/role toggle`で付与・解除を確認する
11. 同一ユーザーで複数のRole追加をほぼ同時に実行し、上限・single排他が崩れないことを確認する
12. Botより上へテストRoleを移動し、操作が安全に拒否されることを確認する
13. Managed Roleを操作できないことを確認する

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
