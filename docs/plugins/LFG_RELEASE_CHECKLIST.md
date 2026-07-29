# LFG Plugin v1 リリースチェックリスト

## CI

- [ ] Prisma Generate
- [ ] Format Check
- [ ] Lint
- [ ] Typecheck
- [ ] 全テスト
- [ ] Supply chain policy
- [ ] Build
- [ ] Production Compose Validation
- [ ] Origin protection configuration validation
- [ ] Production Docker Build / Runtime
- [ ] SBOM
- [ ] High・Critical脆弱性検査

## 環境変数

- [ ] BotとWorkerへ同じ`LFG_COMPONENT_SECRET`を設定
- [ ] `LFG_COMPONENT_SECRET`が32文字以上
- [ ] Workerへ`DISCORD_BOT_TOKEN`を設定
- [ ] `LFG_SCAN_INTERVAL_SECONDS`が10〜300秒

## Database

- [ ] PostgreSQLバックアップ取得
- [ ] migration適用
- [ ] 作成者participant補完結果を確認
- [ ] participant count再集計結果を確認
- [ ] 既存データ不整合SQLが0件
- [ ] 5つのCHECK制約をVALIDATE
- [ ] rollback・復元手順を確認

## Discord実Guild

- [ ] create / show / list / close / cancel
- [ ] join / leave Button
- [ ] 同時joinで定員超過しない
- [ ] 同一ユーザーが二重参加しない
- [ ] 作成者leaveを拒否
- [ ] 満員後のleaveで再募集
- [ ] 改ざんcustom IDを拒否
- [ ] close / cancel / expire後にButton無効化
- [ ] メッセージ削除後に再投稿
- [ ] DB更新失敗後の再投稿が重複しない
- [ ] version競合時に古い表示をactive扱いしない
- [ ] Plugin無効時に期限切れ・同期・復旧が停止

## Studio・監査

- [ ] 作成、検索、status絞り込み、詳細
- [ ] 強制close / cancel
- [ ] 別Guildデータへアクセスできない
- [ ] Audit Logに説明本文が保存されない
- [ ] Workerログに本文・Discord response body・token・stackが出ない
- [ ] `lfg.*` Audit eventを安全に集計できる

詳細手順は`docs/plugins/LFG.md`を参照してください。
