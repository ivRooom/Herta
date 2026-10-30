# VALORANT ランダムピック / 実戦向け構成

対象: /valorant random [map]、Issue #589、PR #590。2026-10-30 Patch 13.09。

## 新方式（旧VC自動抽選は廃止）

/valorant random はDiscordに参加募集メッセージを投稿します。VC接続は不要。
参加、参加取消、抽選、募集取消ボタンを表示し、押した本人のみ参加/取消できます。
募集はGuild/Channel/UUIDで識別され、作成者または ManageGuild/Administrator 権限保持者のみ抽選と取消が可能。
作成者は自動参加しません。参加者0名の抽選は拒否します。上限5名（Guild設定で1～5）。
募集期限は5～180分（既定30分）で、Workerが期限切れを毎時EXPIREDへ更新します。ボタン操作時にも期限切れを判定します。
Bot再起動後もDB正本を使用し、同一セッションの並行操作は行ロックとReadCommitted transactionで直列化します。
Discord表示更新が失敗してもDBの状態は保持します。古いメッセージ表示は後続の操作時に更新されます。
現在の実装は定期的な期限切れメッセージ同期を持ちません。時間経過時点の自動ボタン無効化は未完了です。

mapを省略すると、Guildの有効候補からcrypto.randomInt/Fisher–Yatesによる公平な完全ランダム抽選を行います。
ランク・ロール・マップ・履歴・勝率を参照しません。エージェント重複はありません。

mapを指定すると、有効な複数の構成テンプレートからランダムに選択します。
テンプレートにはエントリー、スモーク、索敵、防衛、相互補完の順で役割を並べています。
1～4人では先頭から割り当て、5人編成として未完成であることを表示します。
有効候補不足でテンプレートが成立しない場合は失敗として参加状態を維持します。
テンプレートは公式マップ一覧/13.09を参照した開発者提案であり、勝率やプロ実績を根拠とした最適構成ではありません。
2026-10-13 Patch 13.08でアセント/スプリットがランクローテーションから除外されていても、カスタム用の候補として選択可能です。

## DB・互換性・プライバシー

新規 migration 20261030100000_valorant_pick_sessions でセッション・参加者テーブルを追加。
同一行のguildIdを必ず指定して参照します。参加者(userId)は該当募集にのみ保存します。
COMPLETED時に候補スナップショット、実際の割当、ルールバージョンと完了日時を原子的に保存します。
新テーブルは既存のValorantAccountLink/ValorantRoster/ValorantAgentを変更しません。
参加者のDiscord IDは終了済みセッション作成後90日間保持します。
Workerが1時間間隔で終了済みセッションの識別子を匿名化します（起動時にも実行）。
セッション・抽選候補・エージェント構成・集計値は削除せず残し、
参加者行を削除し、抽選/試合結果JSONのuserId、作成者/登録者ID、matchIdを削除・匿名化します。
100件ずつではなく50件ずつ処理し、失敗時は次のWorker実行で再試行します。
匿名化済み結果はプレイヤー別の長期追跡には利用できません。

## 統計・試合結果（本番適用済み）

Studio統計ダッシュボード・Guild別履歴集計・参加者傾向・手動試合結果登録は本番へ反映済みです。認証済み画面操作による受入は未検証です。
選出率は候補入りした抽選セッション数を分母にする定義で、現在はマップ・モードを横断したエージェント別の集計値として算出します。
自動試合結果取得は公式VAL-MATCH-V1とRiot承認Production Key/RSOの取得後に実装。
既存Riot ID手入力は試合履歴取得に対するオプトインではありません。
HenrikDevでは事前同意と利用規約/用途制限の確認が必要なため、現段階で自動収集しません。
Match IDだけをもって本人の結果と見なしたり、抽選時刻のみで確定したりしません。

## リリースGate

1. 最新mainとの差分/競合解消、Prisma generate、format、lint、typecheck、unit/integration、build。
2. fresh DB backup + SHA256、隔離restore、exact migration検証、権限とReviewの確認。
3. 承認されたGitHub Actionsでmigration→Bot/Studio rollout。
4. Slash command sync、Bot health/Discord実機参加・取消・同時抽選・認証済Studio・logsの確認。
5. Rollbackは検証済み直前imageへ戻し、追加テーブル/履歴を消さない。破壊的DB restoreは別途承認。

## 2026-10-30 本番適用

PR #590をmainへマージし、Deploy Production run 41033603465 attempt 2で本番デプロイ成功。
DB Migration 3件、Discord Guild登録済み`/valorant random`と`map`、Bot/APIヘルスを確認しました。
Discord実ボタン操作と認証済みStudioの受入は未検証です。詳細は`VALORANT_RELEASE_589.md`を参照してください。
