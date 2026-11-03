# VALORANT 募集期限の公開Discord UI整合（#779 / #789）

## 動作

- DBのexpiresAtを期限の正本とし、期限切れ操作は従来どおりDBで拒否。
- Bot起動後・2分間隔でBotの所属Guildに限定して、未同期かつ期限到来した募集を最大10件ずつ処理（1件ずつ）。Bot再起動後もDBのマーカーを再取得する。
- OPEN→EXPIREDは期限と状態の条件付き更新。同時抽選や取消を上書きしない。Discord公開募集の状態を「期限切れ」に更新し、操作ボタンを外す。
- COMPLETEDの抽選結果・画像・添付・参加者・歴史行を保存。再抽選期限切れでは再抽選ボタンだけを無効化する。
- 再抽選でmessageIdが別sessionへ移動済みなら旧行を同期しない。
- UnknownMessage/UnknownChannelはgoneとして完了。Forbidden/Discord429/一時障害は失敗回数に応じ最大60分の指数バックオフをDBに永続保存する。
- Discord ID・Message内容・Secretをエラーログへ出さない。失敗時もDB側の期限検証は絶対に緩めない。

## Migration・情報保護

- 非破壊Prisma migration: 20261104093000_valorant_expiry_ui_reconcile
- expiry_ui_synced_at (nullable timestamptz(3)): 成功またはメッセージ消失の終端時刻
- expiry_ui_retry_at (nullable timestamptz(3)): 次の再試行時刻
- expiry_ui_retry_count (integer default 0): 失敗回数（最大20）
- Discordの新しい個人情報は保存しない。旧Botへのrollbackでも列をDROPしない。90日匿名化の行データと結果集計は従来どおり。

## 本番リリースゲート

1. PR exact-headのFormat/Lint/Typecheck/Tests/Build・PG integration・ARM64/Grype/Snyk・DB topologyを成功させる。
2. 同一SHA PG16 predeploy CIで合成DBからfresh dump→network=none隔離Restore→exact SQLの正常系と部分適用・checksum改竄の異常系を検証する。
3. 本番は保護されたDeploy workflowで現在の実PG16のfresh backup+SHA256・offline Restoreと正確なSQLのリハーサルを行い、その後だけmigratorを適用。実稼働の4サービスimage SHA・Cloudflare health・Deployment証跡で成功を確認する。
4. Discord有人実機は短い募集（最小5分）を作成して期限後2〜5分以内に公開メッセージが期限切れ・操作不可となることを確認。再抽選期限経過後は元画像を残して再抽選ボタンだけ無効化する。
5. 運営者の承認のないBot再起動・本番Discord権限剥奪・Rate limit注入試験はしない。これらは自動テストで検証する。

## Rollback

- 最後の正常なDeployment証跡の旧イメージSHAへ保護された手動Rollback。追加列と抽選履歴はDROPしない。
- 本番DBバックアップ本文・Discord ID・秘密鍵・IPをIssueへ書かない。
