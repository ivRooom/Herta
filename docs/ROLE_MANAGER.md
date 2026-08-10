# Role Manager

Role Managerは、メンバーが管理者の許可したDiscord Roleを自分で付け外しできるSelf Role機能です。v2ではSlash Commandに加えて、常設のButton / Select Menu型Role Panelを利用できます。

## Studio設定

Role Managerを有効化し、`groups`へSelf Roleグループを追加します。

- `id`: `/role panel`で指定する一意なグループID
- `name`: Panelと一覧へ表示する名称
- `description`: Panelへ表示する補足説明
- `mode`: `single`は1つだけ、`multiple`は複数選択
- `maxSelections`: `multiple`で同時に保持できる最大数
- `panelStyle`: `select`または`buttons`
- `roleIds`: Self Roleとして許可するRole

同じRoleを複数グループへ重複登録しないでください。対象RoleはHerta BotのRoleより下位に置き、Managed Roleを指定しないでください。

## コマンド

- `/role list`: 利用できるグループ・Role・Panel方式を確認
- `/role add role:<Role>`: Roleを追加
- `/role remove role:<Role>`: Roleを解除
- `/role toggle role:<Role>`: 付与状態を切り替え
- `/role panel group:<groupId>`: 実行したChannelへ常設Role Panelを投稿

`/role panel`は「サーバーの管理」権限を持つユーザーだけが実行できます。

## Select Menu Panel

Select Menuで選択したRole集合と現在のRole集合の差分だけを反映します。`single`では1つ、`multiple`では`maxSelections`まで選択できます。全解除はPanel下部の「選択を解除」Buttonを使います。

## Button Panel

RoleごとにButtonを表示し、押すたびにそのRoleをtoggleします。Roleが6個以上ある場合は5個単位でAction Rowへ分割し、最大25Roleまで表示します。

## 安全性

常設Panelのcustom IDはRole変更の根拠として単独では信用しません。操作のたびに最新のPlugin設定を読み、グループ・Roleが現在も許可されているかを再検証します。設定から削除または無効化された古いPanelは変更を実行しません。

Role変更前にはBotの「ロールの管理」権限、Role存在、Managed Role、Role hierarchyを検証します。同一Guild・Userの更新は排他制御し、Button連打や複数操作が重なってもRole更新を直列化します。

## 更新時の注意

StudioでグループのRole構成やPanel方式を変更した場合、既存Panelは自動で見た目を更新しません。新しいPanelを投稿し直してください。ただし古いPanelから設定外Roleを付与することはできません。
