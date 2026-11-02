# VC Recap 復元時・全アクセス経路 Quarantine 設計契約（#731 / #734 → #728）

> **2026-11-02: 合成Port/経路棚卸しのみ。mainへ反映しても本番Bot/API/Studio/Workerには未接続。配信停止・復旧解除の実運用ゲートではない。**
> 親 #728 / #695、外部Ledger #694、PG再適用 #729、所有コピー #730 / #617、運営者公開Go/No-Go #646。

## 現行コード / 将来機能のアクセス境界一覧

- `bot.start` / `bot.stop` / `bot.list` — 現行30日。実装: `apps/bot/src/plugins/vc-recap.ts` と `apps/bot/src/voice/vc-recap-session-manager.ts`。未接続: コマンド実行前・稼働中の遮断。
- `bot.privacy-voice-consent` / `bot.privacy-openai-consent` — 許可と撤回が同一handler内の複合操作。実装: `apps/bot/src/commands/privacy.ts`。承認と保護撤回を別々にfenceする必要がある。
- `bot.privacy-delete` — 本人削除要求は保護操作だが、独立Ledgerへのwrite-first・全コピー消去の検証は未完成。実装: `executeDeleteVoiceData`。
- `bot.privacy-export` / `bot.privacy-web-link` — 本人JSONセッション/発話/要約と同意変更URLは別の情報出力経路。復元epoch・権限を応答直前まで検査する必要がある。
- `bot.transcript-write` / `bot.summary-write` — 現行30日。実装: `apps/bot/src/voice/vc-recap-transcriber.ts`、`vc-recap-speaker-stream.ts`、`vc-recap-summarizer.ts`、`packages/db/src/vc-recap.ts`。未接続: 発話/書込前・要約前の跨サービス障壁。
- `studio.list` / `studio.detail` — 現行30日。実装: `apps/studio/src/lib/vc-recap-studio.ts` と `apps/studio/src/app/dashboard/guilds/[guildId]/vc-recap/`。未接続: 表示前・DB参照直前の遮断。
- `studio.consent-read` / `studio.consent-write` — 同意GETと管理者の許可/撤回POSTを別経路として記録。実装: `apps/studio/src/app/api/guilds/[guildId]/vc-recap/consent/route.ts`。未接続: 認可後・DB参照前・変更前の独立epoch検証。
- `studio.export` — 現行30日。実装: `apps/studio/src/app/api/guilds/[guildId]/vc-recap/export/route.ts`。未接続: 権限取得後・出力前の独立再チェック。
- `api.transcript-read` — 要経路確認。BotのGuild限定内部API・将来公開API境界。未接続: 具体的な内部routeの全数棚卸し。
- `worker.retention` — 現行30日。実装: `apps/worker/src/vc-recap-retention.ts`、`main.ts`。未接続: タイマー起動と一括削除競合の遮断。
- `worker.erasure` — **実運用未登録・OFF**。実装: `apps/worker/src/vc-recap-erasure-sweep.ts`。未接続: 新Worker有効化前の停止ゲート。
- `storage.archive` / `storage.audio` — **本番OFF**。予定: #583/#584、専用S3向け長期本文・話者録音。未接続: Writer/Reader・全Versionと復元の権限境界。
- `storage.signed-url` — **本番未完成**。予定: #585のS3音声再生/署名URL。未接続: 署名URL再利用・TTL・Cache-Control・復元中のアクセス。
- `cache.read-write` — 現行/要棚卸し。予定: 将来索引/Redis/CDNと既存Studio/HTTPキャッシュ。未接続: DB外・CDN/Browser cacheの再公開。

一覧は **設計上の経路識別子** であり、実在する22種類の独立HTTP Endpointを意味しない。詳細のソース根拠と安全区分は `docs/VC_RECAP_ROUTE_INVENTORY.md`。この22 IDでも完全なcall graphや経路遮断は立証できず、親 #728 / #734 で実配線とE2Eが必要。

## offline-only Portと安全区分

#734 で追加した `exposure`（データ配信/生成）、`protection`（削除・失効）、`mixed`（stop後の要約・grant/revoke混在）、`unresolved`（未知API/cache）は **静的なソース棚卸しの分類**。`protection` を実装時に無条件許可してはいけない。隔離復元時も本人の撤回/停止を安全に受け付けるため、実PG owner lock/独立Ledger/分岐ごとの検証が必要。

## 今回追加したPort

`deploy/scripts/vc-recap-restore-traffic-gate.mjs`:

- 22種類の既知のRouteのみ認識。unknown、nil/unavailable、壊れたSchema、別Restore runId、単調epoch不一致、破損日時、期限切れ、future、5分超の証拠を **deny**。
- 受信する独立AuthorityのStateは `kind/scope/restoreRunId/epoch/status/issuedAt/expiresAt/clearance` に限定。**本当に独立したストレージであることの確認と署名検証は、未実装のbackend adapterの責務**。復元DB・単一backup・地元の古いcacheは信頼元にしない。
- 2段階の注入Port `authenticateIndependentControl` と `authenticatePinnedEpoch` は監査真正性・最新アンチロールバックcheckpointを要求。今回のmockが真値を返しても本番権限は付与しない。
- `quarantined` / `restore-pending` は常に deny。すべての独立証拠が揃った `review-pending` でさえ `operator-review-required`（**canResumeTraffic=false**）まで。これ自体は配信のGo/Allowではない。
- 異常時の返却は固定の `{ decision: 'deny', canResumeTraffic: false }`。PII・runId・S3 key・SDKエラーを応答/ログしない。アンロック・ストア書込・外部接続・feature flag変更なし。

## 次の実装・運用担当（親 #728 の残件）

1. **開発側**: 全Bot/Studio/API/Worker/Export/Write/Cache routeの実call graphを補完し、コードでバイパス0をテスト可能にする。今回の一覧に残る内部API/Cacheの曖昧箇所を消す。
2. **開発側**: #694の独立LedgerとQuarantine保管先の形式/IAM・署名検証・epochアンカーの保全方法を設計する。**承認まで外部AWS資源作成や本番切替を行わない**。
3. **開発側**: 配信停止専用の分散read/write middleware、起動時preflight、解除不可状態・epoch cache、rollback、復元DBスナップショット試験。今回のPortを置くだけでは完了しない。
4. **開発側**: #729実PG replay・#730本人全コピー再検証・#694独立監査と合わせて隔離E2E。全経路が停止し続けることを実証し、#695レビュー/Runbookで最終確認。
5. **人間（#646）**: AWS新Bucket/IAM/Object Lock/保管・復元/費用の設計・CloudFormation Change Set・Backup/Rollback・安全な運用担当を個別承認した後に初めて本番接続可。本人音声許諾・正式プライバシー発効前に録音/長期保存をONにしない。

## CIと本番反映の意味

`node --test deploy/scripts/vc-recap-restore-traffic-gate.test.mjs` をBackup Restore Verification CIで実行する。モックからの誤認可、古い証拠、別run、ステータス不足、expiry、例外情報漏えいを安全な合成入力で検証。**本番Deploy successはこのPortのコードが配備された証拠であり、本人削除・全経路停止・新保存の公開受入の証拠ではない。**

現行30日VC Transcribeの動作/プライバシーを維持。PG16→PG17移行、本番S3/IAM/PG操作・録音・保存フラグ変更なし。
