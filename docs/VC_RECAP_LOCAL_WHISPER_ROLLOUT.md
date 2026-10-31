# VC Recap / local faster-whisper (CPU int8) ロールアウト

状態: **実装候補・本番OFF**。#647 (実装)、#577 (性能/品質)、#578 (親)、#518 (Discord E2E)、#646 (本番リリース承認)。PRマージだけではWhisperへ切り替わらない。現行の既定はAWS Transcribe Streaming。

## 守ること

- `VC_RECAP_TRANSCRIPTION_PROVIDER=aws` が既定。既存の本人同意、30日本文保持、音声の非永続保存を維持する。
- `VC_RECAP_TRANSCRIPTION_PROVIDER=local-whisper` の場合、`VC_RECAP_LOCAL_WHISPER_ENABLED=true`・既存の**本人自身による文字起こし明示同意**・トークンが必須。失敗時は**AWS / OpenAIへフォールバックしない**。ロールによる推定同意ではローカル推論を許可しない。
- 音声データは最大8秒の48kHz mono 16-bit PCMとしてメモリでのみ処理する。1話者10分上限、キュー最大3セグメント（約24秒）、worker側1リクエスト10秒以下・並列推論1・Bearer token・レスポンス4,000文字以下。Worker上では一時音声ファイルを生成しない。
- Bot側の呼び出し先は `http://whisper:8765/v1/transcribe` の固定値で、設定値を転送先URLとして利用しない。Dockerのホストへ公開するportsはない。
- Python/faster-whisper側は **モデルを自動ダウンロードしない** (`HF_HUB_OFFLINE=1`・ローカルモデルパス検証)。モデル・ソフトウェアのライセンス、ハッシュ、SBOM/脆弱性は運用側で確認。
- Docker Profile `whisper` を指定しない場合は起動しない。read-only filesystem、非root、cap_drop、no-new-privileges、1vCPU / 1024MiB / 96pidの上限をかける。CPU実測でこのリソースが足りなければ稼働させない。
- **永続音声録音/長期保存とは別機能**。#582〜#585 の明示同意/削除/復元障壁は無断でONにしない。

## 現行の本番制約・評価前提

Herta Lightsailは2 vCPU / 2 GiB RAMの `small_3_0`。DB等の既存サービスと同居するため、Whisper側に1 vCPU/1 GiB上限を設定しても既存プロセスの余力を保証しない。#577で同一の許諾済み日本語音声を使い、CER、固有名詞、RTF、RSSピーク、待機時間、同時話者、停止時flush、正常稼働中のHerta API/Discord遅延を測定する。測定に合格するまではWhisperを本番標準にしない。

## オペレーター準備（人間の承認が必要）

1. #646で、実Guild参加者の音声処理への許諾、公開済みポリシー、検証データの破棄方法を確認。Discord利用規約と国内法令をレビューする。
2. #577で対象のモデルを決める。初期評価は upstream `SYSTRAN/faster-whisper` 1.2.1、CPU int8とし、軽量モデルから試す。第三者の `faster-whisper2` とは異なるパッケージである。元モデルの再配布条件を必ず確認。
3. **本番ホスト外で**管理された取得環境からモデルをダウンロードしてhash/manifestを検証し、`./var/whisper-model` (指定を変える場合は `VC_RECAP_WHISPER_MODEL_DIR`)に配置する。最低限 `config.json` とCTranslate2 modelファイルが必要。Hertaが起動時にネットワークからモデルを取ることは禁止。
4. 本番のPrivate Secret Storeに32文字以上のランダムトークンを登録し、Bot/worker双方へ **同じ値**を `VC_RECAP_LOCAL_WHISPER_TOKEN` として注入。GitHub、Issue、CI、ログ、コミットへ貼らない。
5. 既存PostgreSQL/S3バックアップと復元、CPU/RAM/ディスク監視、インスタンス復元・Rollbackを確認。追加EC2/Lightsailなど有料リソースの作成は別途承認。

## オフラインCIとステージング起動

```bash
# 外部音声/本番データなしで契約をテスト
python3 -m unittest discover -s services/whisper -p 'test_*.py'
pnpm --filter @herta/bot test

# 以下は本番ホストでのみ、モデル配置と秘密情報の設定後に実施
docker compose -f docker-compose.prod.yml --profile whisper config --quiet
docker compose -f docker-compose.prod.yml --profile whisper up -d --build whisper

# readinessはDocker内部のみ: コンテナは外部公開されない
docker compose -f docker-compose.prod.yml --profile whisper ps whisper
```

外部DB切替済みの場合は同じ操作で `-f docker-compose.external.yml` を使う。**Composeの`--profile whisper up -d`だけではBotのprovider設定は変更されない**。カナリアGuildの権限・実測・レビューを先に済ませてから、Botの設定を独立して `VC_RECAP_TRANSCRIPTION_PROVIDER=local-whisper` および `VC_RECAP_LOCAL_WHISPER_ENABLED=true` に変更し、計画に基づきBotを再起動する。

## 失敗/撤回/rollback

- サービス不在・未同意・トークン未設定・worker障害・429・リクエスト45秒超は **文字起こし失敗**として扱い、有料クラウドへ送らない。
- 同意撤回後の新規音声処理やsegment書き込みは拒否する。ただし**進行中のCPU推論そのものを即時停止できることは未検証**。これは#578/#646本番切替のブロッカー。
- Stop時のfile推論flushは現在20秒上限。キュー滞留時に一部発話が要約に入らない可能性があり、**#577の実測と#518の停止テストが合格するまで有効化しない**。
- 緊急停止はまずBotの `VC_RECAP_LOCAL_WHISPER_ENABLED=false`、または `VC_RECAP_TRANSCRIPTION_PROVIDER=aws` への**明示的なRollback**。後者は従来の同意/資格情報に基づくAWS Transcribeを使用するため課金が発生し得る。
- Workerだけを停止する場合は `docker compose -f docker-compose.prod.yml --profile whisper stop whisper`。Botがlocalを指定している間はAWSへ自動fallbackしない。環境変数を変更して再デプロイするまでは新旧どちらの推論を使うか混在させない。
- 本番承認後の記録はPR/issueへCI SHA、モデルID/sha、代表RTF/RSS/CER、CPU他サービスへの影響、デプロイ済みimage SHA、Discord E2E、rollback証拠を残す。音声/本文/トークンそのものは貼らない。

## 未完了事項

- 本番で実際にWhisperが稼働し、VCで文字起こししたという実測 **なし**。
- WorkerイメージのCPU/ARM64両アーキテクチャビルド・脆弱性監査、モデル実体の配布・保証、実Guild・負荷・同意撤回と処理中キャンセル・部分flush・監視は #577/#578/#580/#518/#646 の受入が必要。
- `Studio`のGuild別エンジン設定・AWS使用量ダッシュボードは #581 の別実装。本PRの環境変数だけでStudioから切替できるわけではない。
