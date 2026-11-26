# Birthday Role

Birthday Roleは、Guildメンバーの誕生日を管理し、当日のRole付与・お祝い投稿・Birthday Cardを自動化する公式Pluginです。月日は必須、生年は任意です。

## プライバシー方針

- 保存する基本情報はDiscord User ID、月、日です。
- 生年は年齢付きのお祝いを利用したいメンバーだけ任意で保存できます。
- `/birthday list`には生年・年齢を表示しません。公開され得る一覧から個人情報を増やさない設計です。
- `/birthday me`では本人だけが自分の生年を含む登録内容を確認できます。
- `/birthday remove`で本人が登録を削除できます。
- Guild管理者が本人登録を無効化しても、本人の削除権限は維持します。
- StudioのAudit Logには生年そのものを複製せず、`hasBirthYear`だけを保存します。

## コマンド

- `/birthday set month:<1-12> day:<1-31> [year:<西暦>]`: 自分の誕生日を登録・更新します。生年は任意です。`allowSelfRegistration`がOFFの場合は利用できません。
- `/birthday remove`: 自分の誕生日登録を削除します。本人登録がOFFでも利用できます。
- `/birthday me`: 自分の登録内容を確認します。
- `/birthday next`: Guild timezone基準で次の誕生日を表示します。
- `/birthday list`: 登録済み誕生日を月日順で表示します。生年・年齢は表示しません。

`/birthday list`は登録数が多い場合でも後半を切り捨てず、1900文字以内の複数メッセージへ分割します。

生年は1900年から実行時の現在年までをserver-sideでも検証します。Manifest上のSlash Command入力上限は2100ですが、未来年は保存時に拒否します。

## 共有誕生日登録URL

Herta StudioのBirthday Managementでは `/birthday/register/[guildId]` を共有できます。

- 誕生日データがまだ存在しない初回ユーザーも、このURLから新規登録できます。
- 利用条件はDiscord OAuthで本人確認でき、対象Guildに現在参加している非Botユーザーであることです。固定名の`Member`ロールは要求しません。
- 新規登録・更新はBirthday Role Pluginがインストール済みかつ有効で、`allowSelfRegistration`が許可されている場合だけ利用できます。Plugin停止中や本人登録OFF時はserver-sideでも保存を拒否します。
- 本人登録が無効でも、既存の本人データ確認と削除は利用できます。
- 登録対象のDiscord User IDはclient入力を受け付けず、ログイン中のsession user IDに固定します。
- ページ表示時だけでなくPOST / DELETE時にもBot内部API経由でGuild所属を再確認します。
- Guild未所属、Bot、Discord所属確認不能時はfail closedします。
- mutationはSame-Origin、2KiB JSON上限、Content-Type検証をserver-sideで強制します。

## 年齢とお祝いテンプレート

`announcementMessage`では以下の変数を利用できます。

- `{user}`: 対象ユーザーのメンション
- `{month}`: 登録された誕生月
- `{day}`: 登録された誕生日
- `{age}`: 生年が登録されている場合の年齢。未登録時は空文字
- `{ageText}`: 生年が登録されている場合の `25歳の` のような文言。未登録時は空文字
- `{serverBirthdayNumber}`: サーバー参加後、今回が何回目の誕生日か。計算できない場合は空文字

既定値は次の通りです。

```text
🎂 {user} {ageText}お誕生日おめでとう！
```

生年がある場合は `🎂 @member 25歳のお誕生日おめでとう！`、生年がなければ従来どおり年齢を出さずに祝えます。

## Config Studio

- `enabled`: Plugin全体の有効/無効
- `ephemeralResponses`: コマンド結果を本人だけへ表示
- `allowSelfRegistration`: メンバー本人による`/birthday set`と共有登録URLからの新規登録・更新を許可するか。OFFでもStudio管理者による管理と本人の`/birthday remove`、共有URLからの本人データ削除は利用できます。
- `assignRole`: 誕生日当日のRole付与
- `birthdayRoleId`: 誕生日Role。Role PickerではBotが編集可能なRoleだけを選択します。
- `sendAnnouncement`: お祝い投稿の有効/無効
- `announcementChannelId`: お祝い投稿Channel
- `announcementMessage`: お祝い文
- `leapDayPolicy`: 非うるう年に2月29日生まれを扱う方法
  - `february-28`: 2月28日に祝う
  - `march-1`: 3月1日に祝う
  - `skip`: 非うるう年は自動処理しない

## Birthday Card Studio

Herta Studioの `/dashboard/guilds/[guildId]/birthday` にBirthday Card専用のプレビューエディタがあります。

プリセット:

1. `herta-night-board`: 黒板・夜空調のBirthday Board
2. `herta-lavender-tea`: ラベンダー系Tea Party
3. `herta-lavender-gifts`: ラベンダー系Gift Party

各プリセットはユーザー提供の1672×941デザインをWebPとしてHertaへ同梱しています。

表示内容は個別にON/OFFできます。

- 表示名
- Discord Avatar
- 誕生日
- 年齢（生年登録者のみ）

各要素はX座標・Y座標・サイズをStudioのプレビューを見ながら調整できます。座標はカード左上を0、右下を100とした相対値です。保存時は既存のPlugin Config PATCHを再利用するため、PR #276で導入した設定項目単位の`studio.settings.read` / `studio.settings.write`がserver-sideでも強制されます。

Birthday CardはBot側でPNG生成します。Avatar取得はDiscord CDNのHTTPS URLだけを許可し、5秒timeout・2MiB上限・Content-Type検証を行います。Avatar取得または画像生成に失敗しても、お祝い自体を欠落させずテキストのみで投稿します。

本番Alpine Runtimeには`font-noto-cjk`を追加し、日本語の表示名・`月`・`日`・`歳`を描画できるようにします。

## Birthday Management

Guild管理者はHerta Studioの `/dashboard/guilds/[guildId]/birthday` からメンバーの誕生日を登録・更新・解除できます。

- Discord User Pickerで対象メンバーを選択します。
- 月・日は必須、生年は任意です。
- 2月29日は登録できます。
- 存在しない月日・未来の生年はAPI側でも拒否します。
- 登録時は対象Discord IDが現在そのGuildに所属する非BotメンバーかAPI側でも確認します。
- Bot内部APIで所属確認できない場合、未確認のIDを保存せず503で失敗させます。
- 解除は退会済みメンバーの古い登録も削除できるよう、現在のGuild所属を要求しません。
- 管理者による登録・更新・解除はAudit Logへ記録します。
- `allowSelfRegistration`がOFFでもStudio管理者は登録・更新・解除できます。
- 一覧・CSVではHertaがお祝いした件数、直近年齢、サーバー参加後何回目の誕生日だったかを確認できます。
- mutationはSame-Origin、8KiB request body上限、Guild authorizationをserver-sideで強制します。

Birthday Managementページ自体も`studio.page.view`の`birthday` Resourceで保護されます。Birthday Card設定はPlugin field単位のIAMを追加で適用します。

## サーバー参加後の誕生日回数

誕生日当日の自動処理では`GuildMember.joinedAt`とGuild timezoneを使い、参加日以後に迎えた誕生日を数えます。

例:

- 2024年9月1日参加
- 誕生日は8月19日
- 2026年8月19日のお祝い

この場合、参加後に迎えた誕生日は2025年・2026年なので `2回目` として記録します。

結果は`birthday_celebrations`へ日付ごとのsnapshotとして保存し、後から生年や参加状態が変わっても過去の祝い実績を再計算せず確認できます。年齢も同じsnapshotへ保存します。

## Botプロフィール / サーバー周年

`/dashboard/guilds/[guildId]/bot-profile` から、Herta自身の誕生日として扱うサーバー周年日を設定できます。

- 実在する過去日または当日だけ設定可能
- 将来日は拒否
- Guildごとに`guild_anniversaries`へ保存
- PUT / DELETEはSame-OriginとGuild authorizationをserver-sideで強制
- 設定・解除をAudit Logへ記録

この日付はサーバー周年機能の正本として保持します。周年記念の自動投稿・周年Birthday Card配信は次フェーズでこの値を利用します。

## timezone

日付境界はサーバープロセスのtimezoneではなく、`Guild.timezone`を使用します。Guildにtimezoneが保存されていない場合は`Asia/Tokyo`へフォールバックします。

年齢とサーバー参加後誕生日回数も同じGuild timezoneの日付を基準に算出します。

## Role安全性

自動Role付与・解除の前に以下を確認します。

1. Herta Botが`Manage Roles`を持っている
2. 対象Roleが存在する
3. Managed Roleではない
4. Herta Botから編集可能なRole hierarchyにある

誕生日RoleはDiscord上でHerta BotのRoleより下へ配置してください。

## 自動処理

Plugin有効化時に1回、その後は1時間ごとにGuild単位で日付を確認します。

誕生日当日:

1. Guild timezoneで今日の日付を決定
2. 当日対象者を抽出
3. `GuildMember.joinedAt`からサーバー参加後の誕生日回数を算出
4. 生年があれば年齢を算出
5. `birthday_celebrations`へsnapshot保存
6. Birthday Roleを付与
7. お祝いChannelへテキストと、設定されていればBirthday Cardを投稿
8. Deliveryを`completed`として保存

誕生日終了後:

1. Hertaが過去に付与したBirthday Role deliveryを確認
2. 今日も誕生日のユーザーは除外
3. 付与時に記録したRole IDをdelivery kindから復元
4. Roleを解除
5. 解除deliveryを`completed`として保存

## 冪等性・障害復旧

Role付与、Role解除、お祝い投稿には一意のidempotency keyを使用します。同じGuild・User・日付・処理種別を複数回実行しても、完了済み処理は再実行しません。

祝い実績も`guild_id + user_id + local_date`を主キーとしてupsertするため、worker再実行で重複行を増やしません。

処理中のまま2時間以上更新されていないdeliveryはstaleとして再試行可能に戻します。Bot再起動や一時的なDiscord API障害でも、次の周期で安全に回復できます。

## ivrm-web連携（S5a、#961）

Plugin設定 `useIvrmApiSource`（既定OFF）をONにすると、workerは当日の対象者と配信設定を ivrm-web の署名付きAPI `POST /v2/herta/birthday`（quest-board連携と同じHMAC方式・同じenv `IVRM_WEB_API_BASE_URL` / `HERTA_MBTI_SYNC_SECRET` / `IVRM_INTEGRATION_GUILD_ID`）から取得します。

- 日付判定はJST固定です。Web側がJST日付の月日で対象者を確定し（うるう日ポリシー適用込み）、Botは受け取った対象者へ配信します。
- 契約は schemaVersion 2 です（Round 2、#1023 S-F）。設定の `card.showAge` がONのときだけ、APIは対象者ごとに「その年に迎える年齢」の整数を `age` として含め、カードに年齢を表示します。生年そのものはAPIに含まれません（生年らしきキーが混入した応答は丸ごと不正として扱います）。showAge がOFF（またはキー自体が無い旧設定）のときは `age` キー自体が無く、表示は名前＋月日のみです。お祝いメッセージの変数はWeb側の検証どおりで、`{age}` / `{ageText}` はこの経路のメッセージには含まれません。v1形式の応答しか返らない相手（API未着地）では連携取得を失敗として扱い、従来経路へフォールバックします。
- 配信系設定（お祝い投稿Channel・誕生日Role・お祝いメッセージ・うるう日ポリシー・カードのON/OFF・プリセット・表示項目）はAPIの値が正本になり、この画面の同名設定より優先されます。カードのレイアウト細部（X/Y/サイズ）と背景アセットライブラリは引き続きStudioが正本です。Adminアップロードの背景URL（`card.backgroundUrl`）が指定されている場合はそれを取得して背景に使い、Studio保存済み背景（custom/asset）より優先されます（背景の優先順位: API背景URL ＞ Studio保存済み背景 ＞ プリセット）。取得・検証に失敗した場合は警告ログを出して従来の背景解決へフォールバックします（S5c、#986）。
- APIが `enabled=false` を返した場合は配信しません（前日以前のRole解除だけは通常どおり行います）。
- API取得に失敗した（通信失敗・503・応答不正）場合は、従来の `birthday_registrations` とこの画面の設定へ自動で切り替えて配信を継続し、警告ログを出します（fail-soft）。
- OFFの間は従来どおり動作し、`birthday_registrations` への登録・削除（`/birthday set` / `remove`、Studio管理）も従来どおり使えます。registrationsの読み取り専用化とコマンドの案内文差し替えは、切替ゲート（ivrm-web S6-2）と同時に別途行います。
- ロールバック: Studioで `useIvrmApiSource` をOFFに戻すだけで従来経路へ戻ります（プラグイン再有効化で反映）。API側の配信を止める場合は ivrm-web 側の `BIRTHDAY_DELIVERY_ENABLED` をOFFにします。

## 配信履歴のAdmin表示（S5b、#962）

配信履歴の正本は引き続き `birthday_deliveries` で、複製は持ちません。Studioに署名付きの履歴取得API `POST /api/ivrm/birthday-deliveries/read` を追加し、ivrm-web Adminの配信履歴タブが都度中継して表示します（方式は ivrm-web #1572 のS1未決事項として Kanata が案1＝中継表示で確定、2026-11-23）。

- 認証は daily-fortunes 履歴取得と同じ方式です（`IVRM_INTEGRATION_TOKEN` から purpose `herta-birthday-deliveries-read-v1` で導出した鍵のHMAC、5分以内のタイムスタンプ、対象Guildは `IVRM_INTEGRATION_GUILD_ID` に固定）。契約は `contracts/ivrm/herta-birthday-deliveries-read.v1.json`。
- リクエストは `{guildId, from, to, limit, offset}`（from/to は `local_date` の範囲、limit は最大100）。
- レスポンスの各行は 日付・対象者（Discord User ID）・種別・状態・失敗理由の要約・完了/作成時刻 のみです。種別は保存値 `kind` をカテゴリ化したもの（`announcement`→`card`、`role-assigned:*`→`role_assign`、`role-removed:*`→`role_remove`）で、生の `kind`（ロールIDサフィックスを含む）は出しません。失敗理由は保存済みのエラー名（クラス名）だけを要約として返し、自由文は `UnknownError` に丸めます。生年・年齢はテーブルにもこのAPIにも存在しません。
- 新しい環境変数は不要です（`IVRM_INTEGRATION_TOKEN` / `IVRM_INTEGRATION_GUILD_ID` は既存のStudio連携と共用）。未設定時は 503 で fail-closed になります。

## カード完成形プレビューのAdmin表示（S3d、#991）

Adminの設定プレビューで「実際に配信されるカードそのもの」を確認できるよう、Studioに署名付きのプレビュー描画API `POST /api/ivrm/birthday-card/preview` を追加しました（方式は ivrm-web #1775 で Kanata が案A＝Hertaへ中継描画で確定、2026-11-25）。描画は bot と同一の `@herta/birthday-card` パッケージ（D1、#989）で行います。

- 認証は S5b と同じ方式です（`IVRM_INTEGRATION_TOKEN` から purpose `herta-birthday-card-preview-v1` で導出した鍵のHMAC、5分以内のタイムスタンプ、対象Guildは `IVRM_INTEGRATION_GUILD_ID` に固定）。契約は `contracts/ivrm/herta-birthday-card-preview.v1.json`。新しい環境変数は不要で、未設定時は 503 で fail-closed になります。
- リクエストは `{guildId, card: {preset, backgroundUrl, showName, showAvatar, showBirthday, showAge?}}`（Adminの下書き設定、`showAge` は任意で無し＝OFF）。実効設定の組み立ては bot の API 経路と同一で、土台は Guild の Studio カード設定（レイアウト・保存済み背景）、上書きは preset と表示フラグ、年齢表示はリクエストの `showAge` に従います（#1023 S-F）。背景の優先順位も配信と同じ（背景URL ＞ Studio保存済み背景 ＞ プリセット）です。
- 描画対象は固定サンプル（名前 `Herta Member`、11月22日、アバターはパッケージ内で生成するサンプル画像）で、実在メンバーの情報は使いません。`showAge` がONのときは固定のサンプル年齢（25歳）を描きます。プレビューは副作用なしで、`birthday_deliveries` への記録もしません。
- レスポンスは PNG バイナリ（1672×941）です。Studio と bot は同一の本番イメージ（`font-noto-cjk` 入り）で動くため、フォント条件は一致します。

## Database migration

`20260819095000_birthday_card_v2`で次を追加します。

- `birthday_registrations.birth_year` nullable + CHECK
- `birthday_celebrations`
- `guild_anniversaries`
- Birthday celebration検索用index

既存の月日だけの登録は`birth_year = NULL`としてそのまま利用でき、breaking migrationやbackfillは不要です。

## Release / manual QA

本番反映前に次を確認します。

1. PostgreSQL backup取得
2. `pnpm db:migrate:deploy`
3. `/birthday set`のSlash Command sync（`year` option追加のため必須）
4. 生年なし / 生年ありの登録
5. 年齢付き / 年齢なしのお祝い文
6. 3種類のBirthday Card生成
7. 日本語表示名・英数字表示名・長い表示名
8. Avatar失敗時のテキストfallback
9. 各Card要素の表示ON/OFF、X/Y/サイズ変更
10. 2月29日の3ポリシー
11. サーバー参加後誕生日回数
12. Botプロフィールの周年日設定・解除
13. 別Guild / 権限不足 / Same-Origin失敗が拒否されること

## Environment / infrastructure

- 新しい環境変数は不要です。
- OpenAI APIは使用しません。`OPENAI_API_KEY`は不要です。
- Cloudflare設定変更は不要です。
- Supabase固有の変更はありません。Hertaが使用するPostgreSQLへPrisma migrationを適用します。
