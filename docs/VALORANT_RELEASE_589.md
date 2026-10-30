# VALORANT 機能改修リリース記録

対象: [Issue #589](https://github.com/ivRooom/Herta/issues/589) / [PR #590](https://github.com/ivRooom/Herta/pull/590)
更新: 2026-10-30 JST。状態: **本番適用済み。Discord実機受入が未完了のためIssueはOpenを維持**。

## 新仕様の実装状態（mainマージ・本番適用済み）

- P0: VCの自動参加を廃止し、Discordボタンで参加/取消/抽選/取消。Bot再起動後もDB正本。Guild単位の参加上限1–5、募集期限5–180分、作成者/ManageGuild権限、同一セッションのDB行ロックによる重複抽選防止。
- P1: map選択時は13マップ別の2構成例。1–4人は役割優先の不完全編成と明示。マップ省略時はFisher–Yatesの完全ランダムを継続。公式13.09をルールバージョンとして保存。構成の統計的優位性は未検証。
- P2: 抽選完了時に候補・結果・人数・日時・モード・rulesVersionを保存。StudioにGuild IAMの統計画面とAPI。選出回数/候補入り回数を区別し、標本数30件未満では注意を表示。
- P3: Guild権限付きStudioで手動試合結果の登録・閲覧。勝敗、マップ、ラウンドスコア、Match ID、実使用Agent、K/D/Aを保存。Match ID/セッションの重複登録はユニーク制約で防止。
- 終了済みセッションの参加者IDは90日でWorkerにより匿名化し、抽選・構成・勝敗の集計を保存する。Riot Match IDも匿名化時に削除する。既存Riot IDリンク/HenrikDev MMR機能の契約を変えない。Riot Production Keyと本人のRSO opt-inが未確認のため試合履歴自動収集はしない。

## 本番DBに適用済みのmigration

- `20261029140000_valorant_agents`（既存PR #590）
- `20261030100000_valorant_pick_sessions`
- `20261030103000_valorant_match_results`

すべて新規テーブル/index追加。既存データの破壊的移行は含めない。
本番DBへの適用結果を実機で確認し、失敗したmigrationは0件。

## 2026-10-30 本番リリース結果

- 実装PR: [#590](https://github.com/ivRooom/Herta/pull/590)（squash merge済み）。
- main/本番image SHA: `d7baf905d3d347f0f61a956ee269f9f5ff1e68f3`。
- PRヘッドCI: format/lint/typecheck/test/build・PostgreSQL integration・Prisma readiness・Studio E2E・DB topologyすべて成功。
- 新規Migrationの直前に本番PostgreSQL custom-format dumpをroot専用領域へ保護保存し、SHA-256・隔離PG16復元・3件のexact SQL適用を検証。
- [Deploy Production](https://github.com/ivRooom/Herta/actions/runs/41033603465) attempt 2 成功。初回はLightsailの古いremote-tracking refに起因するfetch失敗。ローカルrefのみを修復し、GitHub Actionsの失敗ジョブを再実行した。
- 本番ホストのBot/API/Studio/Worker image SHAとGit HEADの一致、Migration 3件適用、VALORANT table 6件、不正index 0件、失敗migration 0件を確認。
- API/Botコンテナのhealthはhealthy、Studio/Workerはrunning。Cloudflare経由の外部healthはGitHub Actions上で成功。
- Discord REST APIは対象GuildコマンドをHTTP 200で取得し、`valorant` / `random` / `map`を確認。Studio Auth.js providersは200、未ログインの統計APIは401。
- 直近5分のBot/API/Studio/WorkerログでFatal・panic・未処理例外は0件。
- Rollback候補は直前の正常image `d983cdaad909d0a05ef40a516be001ccac60ef3d`。追加テーブル・migration履歴は保持し、DROP/restoreは通常のrollbackに含めない。
- 認証済みStudio CRUD、Discord参加/取消/抽選の実ボタン操作は未検証として残す。

## 未完了（既知）

- 期限経過時点でのDiscordメッセージの自動ボタン無効化（期限後のクリックは拒否しDB上はEXPIREDに遷移）。
- マップ別構成重みのStudio編集、メタデータの継続更新と十分な勝率根拠。
- Riot公式Production Key/RSO導入とユーザー同意済みmatch自動照合。
- 公式Content Catalogアイコン採用とフォールバック検証。
- Discordでの実ボタン操作と認証済みStudio画面の受入。

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
