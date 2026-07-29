# Team Split Plugin v1 リリースチェックリスト

PR #81（LFG）のマージ後にbaseを`main`へ変更し、最新`main`との差分で以下を確認します。

## CI

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

## 環境変数

- [ ] Bot・Worker・Studioへ同じ`TEAM_SPLIT_SECRET`を設定
- [ ] `TEAM_SPLIT_SECRET`が32文字以上
- [ ] LFG等とは別のランダム値を使用
- [ ] Workerへ`DISCORD_BOT_TOKEN`を設定
- [ ] `TEAM_SPLIT_SCAN_INTERVAL_SECONDS`が10〜300秒
- [ ] Production Composeの展開結果に3サービス分のsecretが含まれる

## Database

- [ ] PostgreSQLバックアップ取得
- [ ] 通常migration適用
- [ ] `team_split_sessions.status`のDB既定値が`open`
- [ ] expiry indexをtransaction外でCONCURRENTLY作成
- [ ] legacy participants＋creatorのバックフィル結果を確認
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
- [ ] randomが同じseed・generationで再現可能
- [ ] rerollでgenerationが増える
- [ ] balancedが明示scoreだけを使用
- [ ] 未指定scoreが0になる
- [ ] split / close / expire後にButton無効化
- [ ] メッセージ削除後に再投稿
- [ ] DB link失敗後の再投稿が重複しない
- [ ] version競合時に古い表示をactive扱いしない
- [ ] Plugin無効時に期限切れ・同期・復旧が停止
- [ ] 再有効化後に状態を回収

## Studio・監査

- [ ] 作成、検索、status絞り込み、詳細
- [ ] 参加者追加・削除・score更新
- [ ] split・reroll・強制終了
- [ ] 別Guildデータへアクセスできない
- [ ] requested seedとseed hashが画面・APIレスポンスへ不要に露出しない
- [ ] Audit Logにseed・チーム結果全体を保存しない
- [ ] WorkerログにDiscord response body・token・stackが出ない
- [ ] `team_split.*` Audit eventを安全に集計できる

詳細手順は`docs/plugins/TEAM_SPLIT.md`を参照してください。
