# VC Recap ソース実装経路インベントリ — offline-only (#733 / #728)

> **重要: これはソース参照の静的棚卸しであり、Quarantineの本番配線・独立した署名検証・旧DB復元後のアクセス遮断の達成ではありません。** `#731` の判断Portも `canResumeTraffic=false` で、稼働中のBot/API/Studio/Workerは未接続です。現行30日AWS Transcribeを変更せず、新しい録音・本文長期保存・Whisper・自動S3消去はOFFを維持します。

## 正本と機械チェック

- `deploy/scripts/vc-recap-restore-traffic-gate.mjs`: 16個の設計上のroute ID（実HTTP Endpoint数ではない）。
- `deploy/scripts/vc-recap-route-inventory.json`: IDごとの実ソースアンカー、状態、未閉鎖のリスク。
- `deploy/scripts/vc-recap-route-inventory.test.mjs`: 全route ID一致、アンカーのファイル/文字列存在、重複・欠落・未知状態・見せかけのguarded判定を検出するオフラインテスト。
- `.github/workflows/backup-restore-verification-ci.yml`: 今回のJSON/test、関連Bot/Studio/API/Worker/DBソース変更時にも静的検証を実行する。

再現コマンド（リポジトリルート・Node.js 22以降）:

```bash
node --test deploy/scripts/vc-recap-route-inventory.test.mjs
node --test deploy/scripts/vc-recap-restore-traffic-gate.test.mjs
```

**検証の意味**: passing = 既知16設計routeの静的な記録と現時点のソース記号が一致した、のみ。dynamic dispatch、別名import、新規エンドポイント、間接DBアクセス、ブラウザ/CDN/Redis cache、並行処理や証拠の真正性を保証しない。これを `bypass=0` または復元時の安全性として報告しない。

## 現時点のルートと要対応区分

- **live（10経路）**: Bot start/stop/list、発話・要約書込、Studio一覧・詳細・同意・Export、Worker30日retention。独立のepochチェックが未接続で、停止・削除など本人保護操作の扱いは要設計。
- **dormant（1経路）**: Worker本人S3削除sweep。関数は存在するが、本番実行登録・全コピー消去・独立監査は未確認。
- **planned（3経路）**: 長期本文Archive、話者録音、署名付き音声URL。#583/#584/#585 が前提で、機能OFFを維持。
- **unresolved（2経路）**: 独立API read、Cache/Index/CDN。呼び出し元・保存先・再公開経路の調査が必要で、漏えい経路ゼロの主張は禁止。

個別のファイルと未完了はJSONに記載。実処理経路は `apps/bot/src/plugins/vc-recap.ts`、`apps/bot/src/voice/vc-recap-session-manager.ts`、`packages/db/src/vc-recap.ts`、`apps/studio/src/app/dashboard/guilds/[guildId]/vc-recap/`、`apps/studio/src/app/api/guilds/[guildId]/vc-recap/`、`apps/worker/src/vc-recap-retention.ts` などから確認した。

## 親 #728 に残す必須作業

1. Botの `/herta-privacy` 系 (`executeVoiceConsent`、`executeDeleteVoiceData`、`executeExport`)、Studio/Web/内部API・非HTTP Consumerの入口までcall graphを確定する。現在の16 IDでは実アクセス全数を保証しない。
2. **#694** 本番DBと同じ復元元に依存しない署名・IAM・単調epochを持つ耐久Authority/独立Ledgerを設計。新AWS/IAM/Object Lock/費用のchange setは #646 承認まで適用しない。
3. **#728** 全プロセスでrestore直前のpreboot、認可前、DB/S3/外部AI/Export/署名URL発行直前に独立判定を配線。失効、stale cache、過去run、署名不正、不達はfail-closed。現行処理を止めずに本番切り替える前の段階導入・rollbackを設計。
4. **#729** 隔離PGにowner lock/atomic replayを接続し、同意とwriter予約をfence。**#730/#617** 全Version/Multipart/派生物/キャッシュ/バックアップコピーの所有者別消去・再公開防止。
5. **#695/#518/#646** 合成→隔離restore E2E、本人同意付きDiscord実機受入、法務/費用/公開の運営Go。解除条件をmockだけで満たしてはいけない。

### 運用判断

- 新規の課金やAWS権限は今回変更不要。CIで静的チェックを導入するだけ。
- 他のCIが通ることと `Deploy Production` 成功は **本番経路遮断の証拠ではない**。
- 人間側には、外部台帳・IAM/費用の個別承認、公式4言語Policy承認、本人同意Guildの提供、最終Go/No-Goが残る。
- 本番データの削除・復元・同意強制変更・新機能有効化は**行わない**。
