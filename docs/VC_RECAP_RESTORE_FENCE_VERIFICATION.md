# VC Recap：復元時の本人削除要求照合ゲート（#689）

## 結論

復元可能なPostgreSQLのdumpがあることと、**本人削除要求を失わずに安全に復旧できること**は別です。

`deploy/scripts/verify-vc-recap-restore-fences.py` は、復元後DBの削除要求一覧と、**復元DB・同じbackupから独立して保持した削除要求台帳**の内容をオフラインで照合します。外部台帳の真正性・鮮度と照合すべき件数は別の認可された監査経路で確定し、スクリプトに渡します。

- **このスクリプトは読み取り専用です。** PostgreSQL/AWS/Discordへの接続・復元DBへのINSERT/UPDATE・S3 DELETEは実行しません。
- スナップショットは64 MiBの上限を超える前に読み込みを打ち切り、復元DBに検証時刻より未来の削除要求日時が含まれる場合は時計ずれ/不整合として **No-Go** にします。
- 「MATCH ONLY」は、入力の間で削除要求が失われていないことを確認しただけです。全バックアップ・S3 version・共有要約・キャッシュの削除、アクセス再開、法務承認を意味しません。
- 独立台帳の生成・更新・暗号化/不変性確保・復元DBへのtombstone再適用、およびデータ配信遮断は**未実装**です。台帳が存在しない現状では必ず **No-Go** とします。
- この照合を `verify-backup-restore.sh` に無条件で組み込んで通常の週次バックアップ検証を壊したり、テスト用の仮台帳で自動的にGo判定したりしません。

## 安全な復旧手順（すべて認可された作業者が隔離環境で実施）

1. Bot/API/StudioのVC Recapデータ取得・エクスポート・録音・アーカイブ・Writerを停止し、**外部台帳と再適用が確認できるまで配信を再開しない**。本番データへの再公開が起きない隔離環境で作業する。
2. 復元するdumpと別の独立保護ストレージから削除要求の正本を取得する。外部台帳の取得時刻・生成時刻・署名または独立して検証されたSHA-256・本人削除要求の監査件数を確認する。**復元したDBから外部台帳を生成してはならない**。
3. 外部台帳のすべてのuserIdについて、復元DB内に削除障壁があることを確認する。不足・古い障壁があれば、ロック付きの認可済み再適用処理で障壁を再登録し、当該userのDB本文/索引・共有要約・S3全version/multipart・複製/キャッシュの削除を検証する。削除完了の印は**全コピー監査後のみ**。
4. 隔離された復元DBから削除要求をJSON形式でエクスポート（以下）。出力ファイルは権限制限し、本人IDの含まれた内容・ファイルパスをIssue/CI/ログへ貼らない。
5. 独立して検証したハッシュ・件数を使い照合を実行。**exit 1なら復旧禁止**。exit 0でも削除Workerのリトライ、復元スナップショット差分、S3版の再スキャン、権限と人間承認が完了するまで公開禁止。

### 外部台帳 JSON（別ストレージで保護、説明用の架空IDのみ）

```json
{
  "kind": "vc-recap-independent-erasure-ledger-v1",
  "generatedAt": "2026-11-01T09:30:00Z",
  "entries": [{ "userId": "123456789012345678", "requestedAt": "2026-11-01T08:30:00Z" }]
}
```

`generatedAt` は最新の削除要求を含めたエクスポート時刻。ツールは現在時刻から既定24時間より古い台帳を拒否します。履歴を削除しないこと、署名/独立スナップショット検証と監査件数の照合は**生成する側の責務**です。このJSONの`kind`文字列は**正本の証明ではありません**。

### 復元された隔離DBの削除要求をエクスポート

復元データが個人情報を含むため、接続先を必ず隔離DBに限定し、出力先ファイルのパーミッションを `0600` にして保管します。SQLの実行により本番のデータは変更されません。

```sql
SELECT json_build_object(
  'kind', 'vc-recap-restored-db-fences-v1',
  'entries', COALESCE(
    json_agg(
      json_build_object(
        'userId', user_id,
        'requestedAt', to_char(
          requested_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    ),
    '[]'::json
  )
)
FROM public.vc_recap_erasure_requests;
```

このSQLの**結果JSONのみ**を隔離環境の `restored-fences.json` に書き込みます。DBのテーブルが見つからない場合はNo-Goです。

### 照合コマンド

```bash
umask 077
python3 deploy/scripts/verify-vc-recap-restore-fences.py \
  --external-ledger /restricted/external-ledger.json \
  --restored-fences /restricted/restored-fences.json \
  --external-sha256 '<independently-verified-64hex-sha256>' \
  --expected-count 123 \
  --max-ledger-age-hours 24
```

`--external-sha256` と `--expected-count` は独立な監査経路で取得したものを指定します。外部台帳ファイルそのものから同じ作業中に計算した値だけでは独立性を検証できません。実際の件数がゼロの場合も標準ではNo-Goです。ゼロ件を独立監査で確認した場合に限り `--expected-count 0 --allow-empty-ledger` を併用できます。

個人ID・元の例外メッセージ・ファイル内容は通常の成功/失敗表示に出しません。ファイルは作業後、保管/削除ポリシーに従って安全に扱います。

## まだ解決していないP0

- [ ] バックアップとは独立した**追記可能・耐改ざん**の削除要求台帳と、本人の削除操作時に台帳への書き込みが永続化される保証。バックアップ時点以降の削除も漏らさない。
- [ ] 再適用を行う認可済みWorker/プロセスと、再適用完了までBot/Studio/APIが本人データを一切配信しない起動ゲート。
- [ ] S3全version/マルチパート、共有要約、索引、CDN/キャッシュ、他リージョンのコピー、復元バックアップの二次スキャンと不一致通知。
- [ ] 災害復旧の手動合成E2E、正しいIAM・鍵・監視/アラート、担当者の承認。#617 / #646 / #518 の受入完了。

**上記が未完了のため、本番でのVC Recap新規録音・長期保存の有効化は禁止です。**

## テスト

```bash
python3 deploy/scripts/verify-vc-recap-restore-fences.test.py -v
```

GitHub Actions `Backup Restore Verification CI` で合成データのみ実行。ユーザーIDは固定の架空ID、S3・DBの接続/書込みなし。
