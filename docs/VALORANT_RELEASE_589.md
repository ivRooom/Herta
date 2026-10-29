# Issue #589 リリース記録

日時: 2026-10-29 JST。関連: https://github.com/ivRooom/Herta/issues/589

## 確認済みの開始点

- 最新main `4a7533a89b893fea17fda45c2a6d89eff59b5803`、PR #587で基本抽選・公式候補チェックボックスが実装済み。重複実装せず残要件を補完。
- Deploy Production run40876860995成功。SSH read-onlyでBot/API/Studio/Worker imageとcheckoutが同SHA。
- API health200、Auth providers200、Bot operational、Discord ready、DB/Redis/Worker正常。
- Discord REST GETで既存Guildのvalorant/random登録済み。
- 実DBはlocal PostgreSQL16。適用済みactive migration62件、失敗0。過去READMEの構成を現在状態として採用していない。

## 今回の変更

- Guild単位Prisma roster/agent、複合キー・名前unique・enabled index・Guild FK。新規テーブル追加のみ。
- Studioの既存認証・Discord管理権限・Studio IAMへ統合したCRUD、冪等初期登録、監査、mobileフォームと削除確認。
- 候補ゼロとDBエラーのfail-closed、メンバー取得失敗時の部分割当防止、Runtime読取前のprivate defer、実行ごとのDB最新候補。
- NestJSがHealthのみのため、実在するStudio Guild APIへ統合。別の認証・管理アプリを作っていない。
- Producer=Studio/DB、Consumer=Bot。同一repo内部のためivrm-contractsの外部契約変更なし。migration→app起動。旧imageは新tableを参照しないためDB rollback不要。

## 検証状況

- focused Bot random/shuffle22件、実Bot dispatcher1件、Studio API認可/CRUD16件は成功。
- root pnpm typecheck / pnpm lint成功。既存packageのlint未設定scriptはそのままで、静的lint完備と解釈しない。
- root format:checkはWindows checkoutの既存CRLF1168ファイルで失敗。無関係な全体整形はしない。Linux CIで確認する。
- root pnpm testは既存MBTIフォントtestのWindows path `Z:/Z:/...` ENOENT2件で失敗。今回の変更外。Linux CIで確認する。
- local build・PostgreSQL実DB integration・Studio E2E・最終CI/reviewは作業中。成功と未実施を混同しない。
- 独立read-only reviewerの指摘（defer位置・安全なエラーログ・Guild切替時のcomponent key）を修正。再レビュー予定。

## 本番適用前gate / rollback

- 本番の新規resource/有料feature/IAM/DNS/Secret変更は対象外。
- fresh protected pg_dumpとSHA256、隔離PG16 restore＋exact migration rehearsalが必要。既存backup scriptはS3 upload/retention削除を伴うため今回は呼ばない。
- root専用backupを保持し、network-none/256MiB制限の一時PGだけをidentity確認後cleanupする。
- CIとレビューを通したmain mergeが既存Herta Deploy Productionを起動する。ユーザーの今回依頼で機能deploy・安全なmigrationは明示承認済み。
- rollback先image/ref `4a7533a89b893fea17fda45c2a6d89eff59b5803`。追加table/dataは保持。DROP/reset/history書換えなし。
- Issueは本番実機受入までopenを維持する。PR merge時の自動closeは使用せず、完了後に明示closeする。

## 未完了 / 次の具体作業

1. exact PR CI、DB integration、PC/mobile E2E、独立再review、バックアップ/隔離復元の証跡を確定。
2. merge→Deploy Production→migration/health/Bot/slash登録/監視logを再検証。
3. 認証済Studio CRUD・実Discord VCコマンドを可能な接続経路で確認し、未検証ならIssueをopenのまま残す。

本記録の開始時点で今回branchからのproduction変更なし。最終適用証跡を追補する。
