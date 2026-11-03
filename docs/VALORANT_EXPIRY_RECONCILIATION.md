# VALORANT 募集期限の公開Discord UI整合（#779 / #789）

## 安全な段階公開（必須・default-OFF）

**コードとAdditive DB migrationの本番反映だけでは、既存Guildの公開Discordメッセージ更新を始めません。** Botの定期同期は次の2条件を両方満たすときだけ起動します。

- `HERTA_VALORANT_EXPIRY_RECONCILE_ENABLED=true`（文字列`true`の完全一致のみ有効）。
- `HERTA_VALORANT_EXPIRY_RECONCILE_GUILD_IDS`に明示承認したDiscord Guild Snowflake ID（17〜20桁）のみをカンマ区切りで指定。**空・無効なIDの混在は全体をOFF**。実IDはGitHub Issue/CI/ログへ記載しない。

`docker-compose.common.yml`のBotに両環境変数を透過。未設定は`false`/空で、安全にOFFのまま起動します。許可GuildだけDBの期限データを検索して公開UIを編集し、他Guildへは触れません。定期同期は2分ごと／最大10件／Retry上限60分のままです。

**人間のGo/No-Go**：まず本人許諾済みの開発専用Guildの管理者が期限切れ公開Embedと再抽選ボタン/画像のE2E、Bot停止/Discord削除権限とDB障害の否定検証を行い、結果を[#779](https://github.com/ivRooom/Herta/issues/779)/[#757](https://github.com/ivRooom/Herta/issues/757)に記録。運営者が既存`.env.production`等の正規Runtime環境の上記2変数をGitHub Actionsの保護された本番配備手順で設定し、明示した1 GuildのみCanaryでONにする。**GitHub Environmentの変数はBotコンテナに自動で反映されるとは限らない**ので、対象Composeが読み込むRuntime環境を実確認する。未承認Guildを追加しない。停止時は`ENABLED=false`（またはUnset）にして保護された手順でBotを再起動し、Discord自動更新が停止したことを確認。停止で既存DBの期限検証は無効になりません。

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
