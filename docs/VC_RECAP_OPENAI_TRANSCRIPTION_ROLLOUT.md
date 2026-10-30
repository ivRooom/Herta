# VC Recap: AWS → OpenAI（Whisper/後継モデル）切替 Runbook

状態: **検証用実装。2026-10-31時点、本番の音声送信はAWSが既定であり、OpenAI音声送信は無効。**

## 対象・挙動

| 設定 | 有効値 | 既定 |
| --- | --- | --- |
| `VC_RECAP_TRANSCRIPTION_PROVIDER` | `aws`, `whisper-1`, `gpt-transcribe` | `aws` |
| `VC_RECAP_OPENAI_AUDIO_CONSENT_READY` | `true`, `false` | `false` |
| `HERTA_AI_KILL_SWITCH` | `true`, `false` | 既存設定 |

- AWSは今まで通りリアルタイムStreamingでセグメントを確定します。
- OpenAIは発言者別48kHz mono PCMを最大20秒のWAVへ変換し、APIへ送信。リアルタイムの部分文字起こしではありません。停止時のflush上限は20秒です。
- メモリに一時保持したPCM/WAVはアップロード後に破棄し、音声ファイルをDB・ディスク・S3に永続保存しません。
- OpenAI APIキーは既存のRuntime Secret Store `openai.api_key` 優先。Runtime Secret Storeが読めない場合はenvへ無条件fallbackしません。
- 音声送信ごとに `vc_recap_explicit_consents` の `purpose=openai_audio_processing`、`policy_version=vc-recap-openai-audio-2026-10-31-v1`、日時・撤回と `vc_recap_erasure_requests` を照会。未適用Migration、DB障害、同意無し、撤回時は**送信しません**。旧AWS-only同意を移行しません。
- OpenAIへの個別同意が無い参加者は、既存のAWS Streaming経路のままです。本人が同意しないことで従来の文字起こしを失わない段階的移行です。
- エラー時に同じ音声を別providerへ転送する自動fallbackはしません。

## 必須リリースゲート

1. #601 のmigration、本人向けOpenAI音声送信の新同意・撤回コマンド、本人削除障壁をCI/DBで検証し、本番へ安全に適用する
2. Herta `/privacy` と ivrm.jp/privacy に「OpenAIへ生の発言音声を送信」「目的」「保存・削除」「本人による同意撤回」を正式に公開し、内容・policyVersionを一致させる
3. 個別本人同意、GuildのVC Recap有効化、録音開始通知と会話終了の処理を実VCで確認する
4. AWS・Whisper・gpt-transcribeで同一の日本語音声を用いて誤認識・処理時間・価格・メモリ・同時話者数・失敗/リトライを比較する（実測ログへ個人音声は保存しない）
5. 機能を公開する直前に `VC_RECAP_TRANSCRIPTION_PROVIDER=gpt-transcribe` を選択し、`VC_RECAP_OPENAI_AUDIO_CONSENT_READY=true` にする。公開後は本人に新しいopt-inがある場合のみ送信される。段階的展開を前提とし、旧AWS同意で一斉切替をしない
6. `HERTA_AI_KILL_SWITCH=true` または `VC_RECAP_OPENAI_AUDIO_CONSENT_READY=false` でOpenAI音声処理を緊急停止する。 `VC_RECAP_TRANSCRIPTION_PROVIDER=aws` はAWSへ戻すためのロールバック

## 価格の試算（2026-10-31時点・音声送信時間、100時間=6,000分）

| 方式 | 公開単価（USD/分） | 100時間概算 |
| --- | ---: | ---: |
| AWS Transcribe Streaming (Tokyo) | 約0.010 | 約$60 |
| OpenAI `whisper-1` | 0.006 | $36 |
| OpenAI `gpt-transcribe` | 0.0045 | $27 |

**音声時間ベースの概算**であり、本人が複数人同時に発言した場合の各話者処理時間、APIの課金最小単位、リクエスト再送、要約コスト、為替、ディスク費用等は含めない。実際の請求と品質は未検証。
公式参照:
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/models/whisper-1
- https://platform.openai.com/pricing
- https://aws.amazon.com/jp/transcribe/pricing/

## Whisperの寿命

OpenAIは `whisper-1` を非推奨とし **2027-02-26に終了予定** と告知。新規本番標準には `gpt-transcribe` を優先する。名称を「Whisper切替」としても、利用者に終了予定のモデルを無期限サポートすると表示しない。

## 禁止事項

- 本番で同意テーブルをコピー/バックフィルしてOpenAI音声処理への許可を擬制しない
- 本人が同意する前にOpenAIへPCM/WAVを送らない
- 旧AWS向けポリシーのままでOpenAI音声処理を有効化しない
- DB障害・同意照会失敗時にfail-openしない
- テスト音声・Transcript・API KeyをIssue/CIログへ保存しない
