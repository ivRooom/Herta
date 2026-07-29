# Team Split Plugin v1 リリースチェックリスト

PR #81（LFG）のマージ後にbaseを`main`へ変更し、最新`main`との差分で以下を確認します。

## CI・レビュー

- [ ] Prisma Generate
- [ ] Format Check
- [ ] Lint
- [ ] Typecheck
- [ ] 全テスト
- [ ] Studio公開レスポンスからseed hashを除外する回帰テスト
- [ ] Supply chain policy
- [ ] Build
- [ ] Production Compose Validation
- [ ] Origin protection configuration validation
- [ ] Production Docker Build / Runtime
- [ ] SBOM
- [ ] High・Critical脆弱性検査
- [x] Button・messageDeleteのPluginイベント配送を実装
- [x] Pluginイベント配送が`matched`・`failed`を返す
- [x] Component処理失敗時のephemeralフォールバックを実装
- [x] 他PluginのButton IDをTeam Splitが消費しない
- [x] WorkerがDiscordチャンネルのGuild一致を検証
- [x] Plugin無効GuildをLIMIT前に除外
- [x] fresh pending行の再投稿を60秒遅延
- [x] message missing更新をTransaction＋Session lock内で実行
- [x] 404以外の表示同期エラーを`failed`として再試行
- [x] Worker shutdownをAbortController＋10秒上限で制御
- [x] 未解決レビュー0件

## 環境変数

- [ ] Bot・Worker・Studioへ同じ`TEAM_SPLIT_SECRET`を設定
- [ ] `TEAM_SPLIT_SECRET`が32文字以上
- [ ] LFG等とは別のランダム値を使用
- [ ] Workerへ`DISCORD_BOT_TOKEN`を設定
- [ ] `TEAM_SPLIT_SCAN_INTERVAL_SECONDS`が10〜300秒
- [ ] Production Composeの展開結果に3サービス分のsecretが含まれる

## Database

- [ ] PostgreSQLバックアップ取得
- [ ] `prisma migrate deploy`を一度だけ実行
- [ ] concurrent expiry indexがmigration履歴内で一度だけ作成される
- [ ] `team_split_sessions.status`のDB既定値が`open`
- [ ] legacyの過去期限`open`・`split`行が`closed`へ移行される
- [ ] legacy participants＋creatorのバックフィル結果を確認
- [ ] 重複participant確認SQLが0件
- [ ] participant count再集計結果を確認
- [ ] sessionとparticipantのGuild不整合SQLが0件
- [ ] 7つのCHECK制約をVALIDATE
- [ ] rollback・DB復元手順を確認

## Discord実Guild

- [ ] `/team create`
- [ ] `/team add`
- [ ] `/team remove`
- [ ] `/team split`
- [ ] `/team reroll`
- [ ] `/team show`
- [ ] `/team close`
- [ ] join / leave Button
- [ ] 作成者が最初の参加者になる
- [ ] 同時joinで定員超過しない
- [ ] 同一ユーザーが二重参加しない
- [ ] 作成者leaveを拒否
- [ ] 改ざん・期限切れcustom IDを拒否
- [ ] 他PluginのButtonが正常に動作する
- [ ] randomが同じseed・generationで再現可能
- [ ] rerollでgenerationが増える
- [ ] balancedが明示scoreだけを使用
- [ ] 未指定scoreが0になる
- [ ] split / close / expire後にButton無効化
- [ ] メッセージ削除後に再投稿
- [ ] DB link失敗後の再投稿が重複しない
- [ ] version競合時に古い表示をactive扱いしない
- [ ] 別GuildのチャンネルIDへ投稿できない
- [ ] Plugin無効時に期限切れ・同期・復旧が停止
- [ ] 再有効化後に状態を回収

## Studio・監査

- [ ] 作成、検索、status絞り込み、詳細
- [ ] 参加者追加・削除・score更新
- [ ] split・reroll・強制終了
- [ ] HTML・502等の非JSONエラーを意味のある文言で表示
- [ ] score入力にアクセシブルなラベルがある
- [ ] 別Guildデータへアクセスできない
- [ ] requested seedとseed hashが画面・APIレスポンスへ不要に露出しない
- [ ] Audit Logにseed・チーム結果全体を保存しない
- [ ] WorkerログにDiscord response body・token・stackが出ない
- [ ] `team_split.*` Audit eventを安全に集計できる

詳細手順は`docs/plugins/TEAM_SPLIT.md`を参照してください。
