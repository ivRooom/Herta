# 今日の運勢 /fortune

## 会員プロフィールを自動利用

管理者がStudioで「今日の運勢」Pluginを有効にすると利用できます。

- `/fortune today`：member.ivrm.jp（ivrm-web）のDiscordに紐づく本人の承認済みプロフィールを取得し、本人だけに画像と運勢を表示。
- `/fortune today public:true`：個人情報と本人向け補足を除き、チャンネルへカードと一般の運勢を公開。キャラクターは固定しMBTIも推測しにくくする。
- `/fortune profile`：今回ivrm-webから取得した本人の情報を確認。登録・修正は https://member.ivrm.jp で行う。Hertaへの二重登録は不要。
- `/fortune forget`：以前Hertaへ手入力した情報だけを削除。ivrm-webの登録は変更せず、以降の占いでも最新の会員プロフィールを都度取得する。公開済みメッセージや保存画像の削除とは別。

現在のivrm-webが提供する誕生日とMBTIを利用。誕生日から星座・年齢・年代・日本の暦年の干支を計算。血液型はivrm-webの保存項目が存在しないため未登録として扱い、A/Tも補完しない。承認済みの最新値だけを使い、Hertaに複製保存しない。未連携・未承認・inactiveは登録案内、API障害・未設定は一時的に取得できない案内を本人だけへ出す。いずれも登録情報なしで占い、過去のHerta手入力値を混ぜない。

## 接続と認証

Producerはivrm-web、ConsumerはHerta。契約は `contracts/ivrm/herta-fortune-profile.v1.bundle.json`（Source of Truth: ivRooom/ivrm-contracts）。`IVRM_WEB_API_BASE_URL`（HTTPS origin）と既存 `HERTA_MBTI_SYNC_SECRET` を使用。root secretから用途文字列 `herta-fortune-profile-v1` のHMACで専用キーを導出するため、既存MBTI同期の署名とは互換でない。新規credential/SSM parameterは不要。

`POST /v1/herta/fortune-profile` へinteractionのguildと本人のDiscord IDだけを署名送信。ProducerのDISCORD_GUILD_IDに限定する。ConsumerもIVRM_INTEGRATION_GUILD_IDを必須とし、送信前に制限。未設定なら送信しない。Botコンテナにも既存の同じ設定を渡す。APIにはユーザーが他人のIDを指定する操作を設けない。timeout 5秒、redirect禁止、no-store、4096bytes上限、requestIdと本人IDと応答型を検証。本文・誕生日・credentialをログに出さない。

## 結果

総合・対人・恋愛・仕事／学び・金・リフレッシュの星と一言、ラッキーカラー・アイテム・数字・時間帯・今日のアクション。プロフィールは本人向けのモチーフと振り返りに使用。日付はGuild.timezone（不正ならAsia/Tokyo）。SHA256のversion・guild・本人・日付で決まる演出のため、プロフィール変更で星を引き直せない。未来の予測精度を保証せず、血液型・年齢で性格や能力を断定しない。

既存Sharpで1200×1420 PNGをサーバー内で生成。画像APIや新しいAWSリソースは不要。結果履歴や画像はDBへ保存しない。Discordへ送信した画像はDiscord側に保持され得る。

## Deploy / rollback

契約→ivrm-web API→Hertaの順にレビュー・CI・merge・deploy。新規DB migration・RLS・IAM・公開ビュー変更なし。ivrm-web未反映時は404により情報なしへ退避するが、通常はProducerからdeployする。

旧 `fortune_profiles` テーブルはロールバックと本人の削除コマンドのため残すが、占いやprofile表示では読まない。通常のrollbackでテーブルや既存データを削除しない。
