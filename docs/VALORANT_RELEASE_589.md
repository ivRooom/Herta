# VALORANT 機能改修リリース記録

対象: [Issue #589](https://github.com/ivRooom/Herta/issues/589) / [PR #590](https://github.com/ivRooom/Herta/pull/590)
更新: 2026-10-30 JST。状態: **本番リリース未完了、IssueはOpenを維持**。

## 新仕様の実装状態（PRブランチ、未マージ）

- P0: VCの自動参加を廃止し、Discordボタンで参加/取消/抽選/取消。Bot再起動後もDB正本。Guild単位の参加上限1–5、募集期限5–180分、作成者/ManageGuild権限、同一セッションのDB行ロックによる重複抽選防止。
- P1: map選択時は13マップ別の2構成例。1–4人は役割優先の不完全編成と明示。マップ省略時はFisher–Yatesの完全ランダムを継続。公式13.09をルールバージョンとして保存。構成の統計的優位性は未検証。
- P2: 抽選完了時に候補・結果・人数・日時・モード・rulesVersionを保存。StudioにGuild IAMの統計画面とAPI。選出回数/候補入り回数を区別し、標本数30件未満では注意を表示。
- P3: Guild権限付きStudioで手動試合結果の登録・閲覧。勝敗、マップ、ラウンドスコア、Match ID、実使用Agent、K/D/Aを保存。Match ID/セッションの重複登録はユニーク制約で防止。
- 既存Riot IDリンク/HenrikDev MMR機能の契約を変えない。Riot Production Keyと本人のRSO opt-inが未確認のため試合履歴自動収集はしない。

## 本番DBに未適用のmigration

- `20261029140000_valorant_agents`（既存PR #590）
- `20261030100000_valorant_pick_sessions`
- `20261030103000_valorant_match_results`

すべて新規テーブル/index追加。既存データの破壊的移行は含めない。
ただしCI用PostgreSQLでの適用成功は本番での安全なmigrationを保証しない。

## リリースの残りGate

1. 最新 `main` とPRヘッドの再照合。CI format/lint/typecheck/unit/integration/build/Studio E2Eを全成功させる。
2. 同時操作・認可・データ分離の統合テストをレビューし、未解決Review/threadと保護ルールを確認する。
3. 現在稼働する本番imageと適用済みmigrationを読み直す。本番DBの新規pg_dump/ハッシュを保護して取得し、隔離PG16へ復元して**同じ3つのmigration**を試行する。
4. 旧imageと新imageの後方互換性、実際のrollback image、DBのダウングレードを伴わない手順を確定する。
5. **バックアップ証跡・必要な承認・CI/Reviewが揃うまではmerge/Deploy Productionしない。**
6. merge後にGitHub Actionsの本番デプロイ、Discord Slash Command同期、Bot health、Studio Guild IAM、Discord実機、ログ監視を行う。実施していない項目は未検証に残す。

## 未完了（既知）

- 期限経過時点での自動Discordボタン無効化と、終了済みセッション90日保持期限のスケジュール実行。
- マップ別構成重みのStudio編集、メタデータの継続更新と十分な勝率根拠。
- Riot公式Production Key/RSO導入とユーザー同意済みmatch自動照合。
- 公式Content Catalogアイコン採用とフォールバック検証。
- 実機のDiscord/Studio受入、本番反映。

`VALORANT_RANDOM.md` が機能説明の正本。本ファイルの以下の内容は2026-10-29時点の旧仕様の履歴であり、今回の仕様と矛盾する場合は上記を優先する。

---

## 2026-10-29時点の旧PR引継ぎ記録

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
