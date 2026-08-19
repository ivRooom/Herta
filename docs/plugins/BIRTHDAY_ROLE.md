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
- `allowSelfRegistration`: メンバー本人による`/birthday set`を許可するか。OFFでもStudio管理者による管理と本人の`/birthday remove`は利用できます。
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
