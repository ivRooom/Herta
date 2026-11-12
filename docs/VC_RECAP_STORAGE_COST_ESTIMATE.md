# VC Recap 音声S3長期保存コスト試算（2026-10-30）

これは**仮定に基づくストレージ保存料の試算**であり、実利用量・請求予定額ではありません。2026-10-30、AWS Price List API `AmazonS3/GetProducts` から東京 `ap-northeast-1` のオブジェクト保管料をread-only取得しました。

| クラス                       | 使用量                          | 料金（USD/GB-month） |
| ---------------------------- | ------------------------------- | -------------------: |
| S3 Standard（最初の50TB）    | `APN1-TimedStorage-ByteHrs`     |                0.025 |
| S3 Standard-IA               | `APN1-TimedStorage-SIA-ByteHrs` |               0.0138 |
| S3 Glacier Instant Retrieval | `APN1-TimedStorage-GIR-ByteHrs` |                0.005 |

AWSのGBは2^30バイト（GiB相当）。数値は税別。価格は変更されるため、本番設定前に再取得する。

## 入力モデル

- Opus音声が**平均24kbps**で話者別保存されると仮定（許諾済み実録音で実際のビットレート/パケット損失を測定する）。
- 月間本人同意済み発話時間を **100 / 500 / 1,000 person-hours** とする。1人×1時間=1 person-hour。無音区間や録音バッファ、プロトコルオーバーヘッド、圧縮効率によって変動する。
- 1 person-hour ≒ `24,000 / 8 * 3,600 / 2^30 = 0.0100583 GiB`。
- 収録月はStandard、翌月以降はIAと簡略化。正確なS3 Lifecycleの30日到達による日割りと移行リクエストは未反映。
- 課金するS3保存容量は毎月同じ量だけ増え、本人削除/サービス終了以外の自動削除はしない。アクセス/復元に伴う増分は計上しない。

## 音声の保存料金のみ（USD・税別）

| 月間person-hours | 1年累計 | 3年累計 | 5年累計 | 1年末の月額 | 3年末の月額 | 5年末の月額 |
| ---------------: | ------: | ------: | ------: | ----------: | ----------: | ----------: |
|              100 |   $1.22 |   $9.65 |  $26.08 |       $0.18 |       $0.51 |       $0.84 |
|              500 |   $6.09 |  $48.25 | $130.39 |       $0.89 |       $2.55 |       $4.22 |
|            1,000 |  $12.18 |  $96.50 | $260.77 |       $1.78 |       $5.11 |       $8.44 |

計算式（Nか月累計、H=毎月person-hours）：

```text
G = H × (24000 / 8 × 3600) / 1073741824  # 毎月GiB
Cumulative(N) = G × (N × 0.025 + N × (N - 1) / 2 × 0.0138)
MonthlyAtEnd(N) = G × (0.025 + (N - 1) × 0.0138)
```

5年後の音声保存容量の想定はそれぞれ60.35 / 301.75 / 603.50GiB。**これはS3保存料のみ**。実請求は以下を足して見積もる。

- S3 PUT、GET、LIST、Lifecycle transition、IA取得GB料金、SSE-KMS要求費、CloudWatch/監査、同一/リージョン間データ転送
- 文字起こし本文のPostgreSQL増分（新同意データの直近365日分）と365日後S3アーカイブ、manifest/index、要約・トピック
- WhisperワーカーのCPU/RAM/電力または追加インスタンス料金、障害時のキュー、モデルキャッシュ、AWS Transcribe fallback（採用する場合）
- バックアップ、削除/復元ジョブ、Versioning/レプリカ、予算アラート、保守監視、消費税

**短い音声オブジェクトの注意:** Standard-IA/Glacier Instant Retrievalには128KiBの最小課金単位がある。24kbpsで1発言5秒（約15KB）を1オブジェクトにすると実サイズの約8.5倍として課金される。このため**話者別で15分前後のまとまったチャンク**を基準候補にし、本人単位の消去と発話offset対応を崩さず小容量オブジェクト数を削減する。Intelligent-Tieringでは128KiB以下のオブジェクトは自動階層化されない。Glacier Instant Retrievalの最低保存期間は90日、Standard-IAは30日で、頻繁な再生がある場合には価格差だけで決めない。

## 実装前の計測と意思決定

1. 許諾済みの開発Guild音声で発話者あたりの平均kbps、チャンク平均KiB、オブジェクト件数、月間利用時間、再生/ダウンロード率を測る。
2. IA遷移/GETの単価をAWS Price List APIで取得し、Standard・IA・Intelligent-Tiering・Glacier Instant Retrievalの**リクエスト込みの5年比較**を実施する。
3. 取得頻度/最小課金/移行リクエストの損益分岐点を検証してLifecycleを設計。128KiB未満の移行対象設定もAWS仕様と照合する。
4. Whisper実測からCPU/RAM追加課金・利用率を計測し、CloudWatch + AWS Budgetsを承認後に構築。現段階で本番リソースやアラートは作成しない。

公式参照: https://aws.amazon.com/s3/pricing/ および https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html
