# VALORANT VC一括参加・参加者管理 / Patch 13.09

対象: #753（VC）、#754（管理）、#755（調査）、#756（メタ）、#757（リリース）、PR #758、親 #589。
作業基準日: **2026-11-03**。開発中のPR状態は [GitHub](https://github.com/ivRooom/Herta/pull/758) を参照し、本文を本番稼働証明とみなさないこと。

## 互換性

- `/valorant random`（マップ省略）はFisher–Yatesで重複なしの完全ランダム。既存候補/履歴/再抽選を維持。
- `map:<マップ>`指定は13マップから選択可能。現行コンペティティブ7マップ外（例: Ascent/Split）もカスタム等で引き続き選べる。
- 戦術構成はHerta独自編集の13マップ×3例。5名の構成単位の候補抽選、1–4名は部分構成。**外部のゲーム内勝率・採用率には根拠を持たせない。**
- `member1..member5`即時抽選とCOMPLETED行を残す再抽選は既存仕様を維持。

## 参加募集と対象VC

- 作成時は作成者が接続しているGuild内のVC IDをセッション行へ保存し、途中で自動変更しない。
- 未接続なら`voice_channel_id = NULL`。手動参加は常に可能。VC一括参加の初回操作時に対象GuildのVCを明示選択→**固定確定**する。
- `🔊 VC全員参加`は人間ユーザーをGateway voice-state一覧から取得し、GuildMemberの実在とBot属性を確認。追加候補をephemeralで表示したあと明示確定する。
- 定員超過時はUser Selectで追加する人を選択し、選択した人のみ追加。先頭・乱数で勝手に選ばない。プレビューから実行までに音声メンバー/既存参加者/opt-outが変わったらSHA-256チェックサム不一致として再取得を求める。
- VC人数100名超、API権限不足、Discordの取得失敗はfail-closedで更新しない。VC退出者は自動削除しない。Gateway `GuildVoiceStates` intentは既存Bot構成で有効。
- セッションで本人が`参加取消`したIDは`opted_out_user_ids`へ記録。以後VC一括追加では除外。本人再参加/作成者個別追加時のみ解除。

## 参加者管理（抽選前のみ）

- 募集Embedは2行: 参加 / 参加取消 / 抽選 / 募集取消、🔊 VC全員参加 / 👥 参加者管理。
- `👥 参加者管理`のephemeral UIで参加者確認、Guild User Selectによる1人追加、現在参加者Selectによる1人除外、VC再取得。**選択→個別確定/キャンセル**。一度に複数人のドラフトを保持しない最小構成。
- 作成者または`ManageGuild`/`Administrator`のみ管理可能。一般参加者は本人参加・本人取消と公開一覧のみ。API側に毎回認可を置き、UIの非表示だけに頼らない。
- 行ロック`FOR UPDATE`とGuild/Session/定員/期限/状態の再検査で一括追加、手動追加、本人参加、抽選を直列化。抽選完了・取消・期限切れ後は管理不可。
- DB更新後Discord Embedの編集が失敗してもDBを正本に維持し、エラーは日本語で表示。

## データ/プライバシー

`20261103160000_valorant_voice_participants` を**追加migration**として適用:

| 列                                          | 型              | 旧行の値 | 用途                     |
| ------------------------------------------- | --------------- | -------- | ------------------------ |
| `valorant_pick_sessions.voice_channel_id`   | TEXT NULL       | NULL     | 固定された対象VC         |
| `valorant_pick_sessions.opted_out_user_ids` | TEXT[] NOT NULL | 空配列   | 本人が取消したユーザーID |

- 90日匿名化では参加者ID削除に加えopt-out配列とVC IDもクリア。履歴、構成、抽選結果・統計は保持。
- 旧イメージへロールバックしても追加列をDROPしない。切替前の正常imageに戻してBot/API/Studio healthを確認。本番migration前のPG custom-format backup・SHA-256・隔離restore/リハーサルが必須。

## 出典と最新性（調査日: 2026-11-03）

- [Riot公式 Patch 13.09（2026-10-27）](https://playvalorant.com/ja-jp/news/game-updates/valorant-patch-notes-1309/): 新Agent Hush、CloveのPick-Me-Up移動速度15→10%、Warden武器調整。
- [Riot公式 Patch 13.08（2026-10-13）](https://playvalorant.com/ja-jp/news/game-updates/valorant-patch-notes-13-08/): コンペティティブにBind/Corrode、Ascent/Splitが除外。現行PoolはAbyss/Bind/Corrode/Haven/Lotus/Summit/Sunset。
- `apps/bot/src/plugins/valorant-meta.ts`に確認済みPatch/公式URL/確認日/Pool/不明値nullを版管理。ゲーム内の採用率・勝率・5人構成勝率のデータは**未取得**（0%ではない）。
- [THESPIKE利用規約](https://www.thespike.gg/terms-of-use)には無断crawl/spider・コンテンツ複製に制約あり。自動取り込みは実装しない。
- [Riot Developer Policy](https://developer.riotgames.com/docs/valorant): プレイヤーデータ連携はRSO本人opt-in/Production Keyなどの条件あり。現行のHerta抽選統計は**ゲーム内成績ではない**。Riot Match自動取得は本タスク対象外。

## リリースGate（PR/CIの実結果で判定）

- [ ] 最新headのformat/lint/typecheck/unit/build/PG integration/security全成功
- [ ] 未解決review/thread/変更要求/競合なし、検証済みreview
- [ ] migration直前backup・checksum、隔離restore・同一SQL rehearsal
- [ ] main merge→CI-gated Deploy Production→migration・image/health・Discord command・ログ確認
- [ ] **有人Discord E2E**：VC 5名→一括追加→1名除外→別の1名追加→マップなし抽選→履歴確認
- [ ] **有人Discord E2E**：map指定戦術構成/1～4名・再抽選・他Guild・一般参加者権限を実機確認
- [ ] 認証済みHerta Studioで既存Guild IAM/統計が変わらないことを確認

Discord実操作、AWS本番への接続、Riotの利用申請ができない場合は**未検証/Blocked**を維持し、合格と報告しない。
