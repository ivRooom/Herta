# VC Recap ソース経路・Privacy 操作区分 — offline-only (#733 / #734 / #728)

> **重要**: これはソース参照と操作分類の静的棚卸しで、Quarantine の本番配線・独立署名検証・旧DB復元後のデータ遮断ではない。分類 `protection` も **アクセスを許可する設定ではない**。現行30日 AWS Transcribe を変更せず、録音・長期本文保存・Whisper・自動S3消去はOFFを維持する。

## 実装の証拠とチェック

- `deploy/scripts/vc-recap-restore-traffic-gate.mjs`: 27 の**設計上の**経路ID（HTTP endpoint の完全列挙ではない）。評価器は `canResumeTraffic=false` のみを返し、本番 Runtime に未接続。
- `deploy/scripts/vc-recap-route-inventory.json`: ソース位置・稼働区分・操作区分・未対処のギャップ。
- `deploy/scripts/vc-recap-route-inventory.test.mjs`: 27 ID の一意性、旧 `studio.consent` ID 残存、Privacy 経路欠落、アンカーの存在、未分類・不正分類を拒否。
- `deploy/scripts/vc-recap-restore-traffic-gate.test.mjs`: 追加した操作でも隔離中は deny、合成レビュー状態も交通許可しない。
- `.github/workflows/backup-restore-verification-ci.yml`: 該当契約・各ソースファイル変更で検証を実行。

リポジトリルート（Node.js 22以降）:

```bash
node --test deploy/scripts/vc-recap-restore-traffic-gate.test.mjs
node --test deploy/scripts/vc-recap-route-inventory.test.mjs
```

passing は「既知の設計routeとソース内文字列が一致し、不正な操作区分が検出できる」まで。動的呼び出し・並行処理・独立台帳の真正性・新規入口・Cache / CDN / Redis・DB restore 後の実際の遮断を証明しない。

## 最新の非Slashライフサイクル入口（#734継続）

- `bot.lifecycle-stop`（live / mixed）: `apps/bot/src/plugins/vc-recap.ts` の `handleVoiceStateUpdate`（VCが空になると自動停止）と `onDisable`（Plugin無効化時停止）は **`/vc-recap stop` を経由しない**。停止そのものは安全のため必要だが、共通 `stopVcRecap` はその後に本文読み取りと要約処理を行う。復元Quarantine時には**停止と後続配信を分離して遮断**しなければならない。
- `deploy/scripts/vc-recap-boundary-callgraph.test.mjs` は `privacy.ts` の5サブコマンド・`vc-recap` の3サブコマンド・自動停止・同意GET/POST・本人Export・Studio Export・3providerの静的呼び出し順と回帰変異を検査する。`node --test deploy/scripts/vc-recap-boundary-callgraph.test.mjs`。
- これは **静的・ソース断片の整合チェック** であってASTによる網羅的解析、実ランタイムの認可、署名Authority、DB復元前遮断、キャッシュ再公開禁止を意味しない。新規間接経路・未確認API/cache・他ファイルを含む完全call graphは引き続き#734/#728の残件。

## 2026-11-03｜追加のトークン・ボタン入口（#734）

- `bot.consent-button`（mixed）：メッセージに残るDiscordの yes/no/web ボタン。保護的な撤回を維持しつつ許諾とURL発行を独立してガードする必要がある。
- `studio.token-consent-page`（exposure）：`/consent/[token]` で既存30日同意と長期同意状態を読み取る。トークンの正当性だけで復元Quarantineを解除しない。
- `studio.token-consent-write`（mixed）：`POST /api/consent/[token]` で既存30日同意を付与・撤回。Guild管理者のPOSTとは別経路。
- `studio.token-long-term-write`（mixed）：`POST /api/consent/[token]/long-term` の3目的選択・撤回・削除要求。長期保存受付はOFFのまま。
- 新経路も静的ソースアンカー・CI triggerで追跡するだけであり、本番遮断もgrant許可も実装しない。

## 新たに独立把握した入口（#734）

- `bot.privacy-voice-consent`（mixed）：`executeVoiceConsent`。true許可とfalse撤回を別処理として実ガードする。
- `bot.privacy-openai-consent`（mixed）：`executeOpenAiAudioConsent`。OpenAI新規許諾と撤回は同一処理内で分岐する。
- `bot.privacy-delete`（protection）：`executeDeleteVoiceData`。削除要求受付・DB消去。全コピー消去完了の証拠ではない。
- `bot.privacy-export`（exposure）：`executeExport`。本人向けJSONにVCセッション/発話本文/要約が入る。
- `bot.privacy-web-link`（exposure）：`executeWebLink`。本人管理URL発行時も独立に安全性を検査する。
- `studio.consent-read`（exposure）：`GET /api/guilds/[guildId]/vc-recap/consent`。同意状態・メンバー情報を閲覧する。
- `studio.consent-write`（mixed）：`POST /api/guilds/[guildId]/vc-recap/consent`。管理者による許可/撤回の両分岐を保護する。

従来の `studio.consent` は GET/POST を混同するため削除した。Studio CSV/JSON `studio.export` は別入口のままであり、Export内の Prisma 本文検索・認可・応答直前再検証を要する。

## 操作区分と最終統合の契約

- **exposure**: 本文/要約/同意状態の読み取り、発話の生成/保存、外部AIへの転送、Export、トークン発行。独立Quarantineの再検証とオーナー権限が無い限り配信/書き込みは禁止。
- **protection**: 期限による消去、本人削除要求・撤回など本人を保護する操作。Quarantine中も安全に処理すべきだが、独立Ledgerの write-first、owner lock、再試行、監査が未配線なら実装上の許可は出せない。
- **mixed**: stopには音声キャプチャ停止と要約/外部AI連携が混在し、同意のPOST/Discordにも許可と撤回が混在する。**操作単位/分岐単位で runtime 実装を分離**する。全体に「常時通す」または「常時拒否」を適用しない。
- **unresolved**: `api.transcript-read` と `cache.read-write`。現時点で実装入口・消去対象が未確定で、bypass=0 と断定しない。

現時点: live 21 / dormant 1 / planned 3 / unresolved 2 = **27**。上記操作分類は**試験用メタデータ**で、稼働中の Bot / API / Studio / Worker には一切適用されない。

## 実運用まで残るもの（Issue正本）

1. **#734 → #728**: 動的call graphを全経路追跡し、どの分岐を守りどの保護操作を生かすかを決定。Botの独立プライバシーコマンド、StudioのGET/POST/Export、Worker、外部AI出力、SDK、署名URL、未確認API/cache/indexを含む全処理に **preboot・認可前・DB/S3/外部送信直前** の独立フェンスを配線。
2. **#694**: DB/同一Backupから解除不能な独立Ledger・署名・epoch・IAM・Object Lockを検証。新AWS/IAM/料金は#646の個別承認前に本番適用しない。
3. **#729 / #730 / #617**: 隔離実PostgreSQLの所有者lock/replay、全S3版・Multipart・派生要約・キャッシュ・バックアップ・全コピーの消去/restore replay。
4. **#695 / #518 / #646**: 旧DB復元E2E、本人同意済みDiscord Guild受入、法務・費用承認、限定Canary、最終Go/No-Go。

## 本番配布の線引きとRollback

今回のPRで本番へ配れるのは **契約のroute ID、静的棚卸し、CI、ドキュメントのみ**。現行30日VCを維持し、AWS/IAM、個人データ、PG16→PG17、録音/長期保存の環境変数、権限・解除スイッチは変更しない。

CI不合格または利用中のVCに変化があればこのPRのコミットを revert し、旧デプロイSHAへ戻す。runtime gate の実配線後は、**旧リリースへのRollbackが誤解除とならない**独立Authorityの世代チェック・復元Runbookを別途必須とする。
