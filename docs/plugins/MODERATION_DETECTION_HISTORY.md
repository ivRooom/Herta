# Moderation自動検知履歴・誤検知レビュー

Moderation Plugin v2のobserve-only検知を、Studioから確認・分類するための運用機能です。自動削除や自動処罰は行いません。

## 保存する情報

- Guild ID
- Discord Message ID
- Channel ID
- User ID
- 検知種別
- 本文の文字数
- 観測数と閾値
- 設定配列内のrule index
- 検知日時
- レビュー状態・レビュー担当者・レビュー日時・備考

## 保存しない情報

- メッセージ本文
- 一致した単語
- 正規表現文字列
- Discord招待コード
- 添付ファイル
- 前後の会話

検知履歴テーブルには本文用カラムを設けていません。Botの構造化ログにも本文や一致値を出力しません。

## 重複排除

同一Discord Messageに対する同一検知種別・同一rule indexからidempotency keyを生成します。Discordイベントの再配信やRuntime再接続が発生しても、同じ検知履歴は1件だけ保存されます。

## レビュー状態

- `unreviewed`: 未確認
- `confirmed`: 正検知
- `false_positive`: 誤検知
- `ignored`: 集計対象として残すが対応不要

レビュー操作は`moderation.detection.review`としてAudit Logへ記録します。検知種別、Message ID、Channel ID、User ID、変更前後の状態を記録し、本文は記録しません。

## Studio

Moderation Plugin詳細から「自動検知レビュー」を開きます。

- 検知種別
- レビュー状態
- User ID
- Channel ID
- 開始日・終了日

で絞り込みできます。検知件数、未確認件数、正検知件数、レビュー済みに対する誤検知率を表示します。

## DB migration

`20260806164000_add_moderation_detection_events`を適用します。

```bash
pnpm db:migrate:deploy
```

本番環境ではアプリケーション更新前にmigrationを適用してください。migration未適用時も自動検知そのものは継続しますが、履歴保存は警告ログを出して失敗し、Studio履歴画面は取得エラーを表示します。

## 保持期間

`pruneModerationDetections`はGuild単位で30〜3650日の保持期間を指定できます。初期リリースでは自動削除ジョブへ接続せず、運用方針を決めてからWorkerへ追加します。

## 次フェーズへ進む条件

- 7日以上のobserveデータがある
- 未確認イベントが定期的にレビューされている
- 誤検知率と検知種別ごとの偏りが把握できている
- 除外Channel・Role・UserとWord Filter設定が調整済み
- 緊急停止手順が確認済み

条件を満たした後、Moderation Case自動作成、メッセージ削除、警告、タイムアウトを個別opt-inで追加します。
