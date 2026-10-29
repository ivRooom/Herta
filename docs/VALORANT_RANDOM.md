# VALORANT VCランダムエージェント抽選

## 使い方

1. Herta Studioで対象Guildの `Plugins > Valorant` を開きます。
2. Pluginとコマンドを有効化し、エージェント一覧で抽選候補を登録して保存します。
3. DiscordでVCへ参加し、`/valorant random` を実行します。
4. 実行者と同じVCにいるBot以外の参加者に、異なるAgentを1名ずつ割り当てて公開します。

## 設定・認可

- `enabledAgents: string[]` はGuild Pluginのconfigに格納します（1〜30名、公式Agent名、重複不可）。
- 未設定の既存Guildは公式30名をデフォルト候補として扱い、既存のRiot ID連携に影響を与えません。
- Studioの編集は既存のGuildアクセス権、Plugin configのIAM、同一Origin判定、Ajv、監査履歴、Runtime設定同期を利用します。
- Commandは `GuildVoiceStates` Intentを使用します。同じVCのVoiceStateから参加者を抽出し、GuildMemberキャッシュ欠落時には個別fetchします。取得不能なメンバーのみ除外します。Botや別VCのユーザーは抽選対象外です。
- HenrikDev APIやVALORANTのアカウント連携はランダム抽選に不要です。
- 候補がVC参加人数より少ない場合は、重複割り当てをせずエラーを返します。
- 公式一覧: https://playvalorant.com/en-us/agents/ 。次の公式新Agent追加時は `packages/plugin-catalog/src/manifests/valorant.ts` の `VALORANT_AGENTS` を更新します。

## リリース・確認

1. `pnpm --filter @herta/plugin-catalog typecheck`
2. `pnpm --filter @herta/bot typecheck` / `pnpm --filter @herta/bot test`
3. `pnpm --filter @herta/studio typecheck` / `pnpm --filter @herta/studio build`
4. PR CI・review・mergeabilityを確認した後、mainをmergeし本番GitHub Actionsのdeploy成功を確認します。
5. Studioで対象GuildのPluginを有効化（本番Guild設定操作のため明示承認が必要）し、Slash CommandとVC実機を確認します。

ロールバックは直前の成功した本番デプロイのimageへ戻し、DBのPlugin設定は履歴から復元します。DB migrationは不要です。
