# Plugin Config Path IAM

Plugin設定は、top-level fieldだけでなくJSON Schema上の設定パス単位で `studio.settings.read` / `studio.settings.write` を制御できます。

## Resource

既存Resource形式を維持します。

```text
guild:{guildId}:plugin:{pluginId}:config:{configPath}
```

例:

```text
guild:123456789012345678:plugin:moderation:config:autoEnforcementPolicies
guild:123456789012345678:plugin:moderation:config:autoEnforcementPolicies%5B%5D.action
```

Canonical pathはObjectを `.`、Array要素を `[]` で表現します。実際の配列indexはPolicy Resourceへ含めず、`autoEnforcementPolicies[0].action` と `autoEnforcementPolicies[1].action` はどちらも `autoEnforcementPolicies[].action` で評価します。

## Inheritance

子設定は親ResourceのPolicyを継承します。

- 親 `Allow` + 子 `ImplicitDeny` → Allow
- 親 `ImplicitDeny` + 子 `Allow` → Allow
- 親または子に明示 `Deny` → Deny

明示Denyは複数Role / Managed Policyをまたいでも優先されます。

## Read boundary

`studio.settings.read` が導入済みのユーザーには、許可された設定パスだけをserver-sideで抽出して返します。Arrayのindexは保持しますが、許可されていない兄弟propertyはレスポンスへ含めません。

Policy未導入のManage Guildユーザーと、`studio.settings.read` をまだ利用していない既存Policyについては従来互換を維持します。

## Write boundary

制限モードのStudioは `configPathPatch` を利用して既存の具体的な設定パスだけを更新します。

```json
{
  "configPathPatch": [
    {
      "path": ["autoEnforcementPolicies", 0, "action"],
      "value": "timeout"
    }
  ]
}
```

Serverは以下を再検証します。

- Same-Origin
- Guild / user authorization
- JSON body size / operation count / path depth
- JSON Schema上のcanonical path
- 親から子までのIAM Allow / Deny
- Object / Arrayの現在の実在pathとarray index
- 変更後のPlugin config全体に対するSchema validation

Object / Arrayコンテナ全体を置換する場合は、そのコンテナ配下の全Resourceにwrite権限が必要です。これにより、親Resourceの書き換えで子Resourceの明示Denyを迂回できません。

## Structural changes

Array要素の追加・削除・並び替えなど構造全体を変える操作は、そのtop-level/container全体を編集できる場合だけ従来の全体Editorから行います。子設定だけ許可されたユーザーは既存要素の許可されたleafのみ編集できます。
