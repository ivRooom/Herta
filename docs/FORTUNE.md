# 今日の運勢 /fortune

## 会員プロフィールを自動利用

管理者がStudioで「今日の運勢」Pluginを有効にすると利用できます。

- `/fortune today`：member.ivrm.jp（ivrm-web）のDiscordに紐づく本人用プロフィール（未登録時は承認済み公開プロフィール）を取得し、本人だけに画像と運勢を表示。
- `/fortune today public:true`：個人情報と本人向け補足を除き、チャンネルへカードと一般の運勢を公開。キャラクターは固定しMBTIも推測しにくくする。
- `/fortune profile`：今回ivrm-webから取得した本人の情報を確認。登録・修正は https://member.ivrm.jp で行う。Hertaへの二重登録は不要。
- `/fortune forget`：以前Hertaへ手入力した情報だけを削除。ivrm-webの登録は変更せず、以降の占いでも最新の会員プロフィールを都度取得する。公開済みメッセージや保存画像の削除とは別。

本人が保存した誕生日・任意の血液型・MBTIを利用。誕生日から星座・年齢・年代・日本の暦年の十二支を計算し、星座・十二支の本人指定を優先する。出生時刻を使う天体計算や旧暦/立春の年境界ではない。本人用情報は公開審査前から利用でき、Hertaへ複製保存しない。プロフィールがない場合は登録案内、対象外guildはサーバー制限の案内、未設定は管理者への設定案内、API障害は一時的な取得失敗の案内を本人だけへ出す。いずれも登録情報なしで占い、過去のHerta手入力値を混ぜない。

## 接続と認証

Producerはivrm-web、ConsumerはHerta。契約は `contracts/ivrm/herta-fortune-profile.v2.bundle.json`（Source of Truth: ivRooom/ivrm-contracts）。`IVRM_WEB_API_BASE_URL`（HTTPS origin）と既存 `HERTA_MBTI_SYNC_SECRET` を使用。root secretから用途文字列 `herta-fortune-profile-v2` のHMACで専用キーを導出するため、既存MBTI同期の署名とは互換でない。新規credential/SSM parameterは不要。

`POST /v2/herta/fortune-profile` へinteractionのguildと本人のDiscord IDだけを署名送信。ProducerのDISCORD_GUILD_IDに限定する。ConsumerもIVRM_INTEGRATION_GUILD_IDを必須とし、送信前に制限。未設定なら送信しない。Botコンテナにも既存の同じ設定を渡す。APIにはユーザーが他人のIDを指定する操作を設けない。timeout 5秒、redirect禁止、no-store、4096bytes上限、requestIdと本人IDと応答型を検証。本文・誕生日・credentialをログに出さない。

## 結果

総合・対人・恋愛・仕事／学び・金・リフレッシュの星と一言、ラッキーカラー・アイテム・数字・時間帯・今日のアクション。プロフィールは本人向けのモチーフと振り返りに使用。日付はGuild.timezone（不正ならAsia/Tokyo）。SHA256のversion・guild・本人・日付で決まる演出のため、プロフィール変更で星を引き直せない。未来の予測精度を保証せず、血液型・年齢で性格や能力を断定しない。

既存Sharpで1200×1420 PNGをサーバー内で生成。画像APIや新しいAWSリソースは不要。結果履歴や画像はDBへ保存しない。Discordへ送信した画像はDiscord側に保持され得る。

## Deploy / rollback

契約→ivrm-web API→Hertaの順にレビュー・CI・merge・deploy。HertaのDB migration・IAM変更なし。ivrm-webは非公開プロフィールのadditive migrationを先に適用し、v1/v2 APIを併存させる。ivrm-web未反映時は404により情報なしへ退避するが、通常はProducerからdeployする。

旧 `fortune_profiles` テーブルはロールバックと本人の削除コマンドのため残すが、占いやprofile表示では読まない。通常のrollbackでテーブルや既存データを削除しない。

## 本文のバリエーション (2026-10-17)

32テーマ×32の切り口による1,024の本文・見出しパターンを fortune-patterns.ts で管理する。星数や数字だけの組み合わせをパターン数に含めない。本人/guildのhashから開始位置と奇数stepを選び、日数による1,024要素の順列で選択する。同じ人の連続1,024日間は同じ本文にならず、同日は固定。プロフィール編集で引き直せない。カードの文字数上限と全本文の一意性、連続日付の全巡回をテストする。

## プロフィールからのMBTIリンク

既存Bearer連携 `POST /api/integrations/ivrm/guilds/{guildId}/mbti`。ivrm-webは認証セッション由来の本人IDとquiz/resultだけを送信し、Hertaは設定guildと照合する。quizはMBTI plugin有効時のみ、未完了・未失効セッションを再利用（なければ24時間の新規セッション）。結果は既存の30分の本人履歴リンクを発行する。本人限定・no-store / no-referrer。新規secret不要、リンク・ID・生年月日をログに出さない。

算出参考: https://eco.mtk.nao.ac.jp/koyomi/wiki/BDBDC6F3BBD9.html / https://weathernews.jp/s/topics/201803/160075/ 。境界付近の流派差は手動指定で調整する。
