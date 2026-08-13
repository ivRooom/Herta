# Birthday Role

Birthday Roleは、Guildメンバーが誕生日の**月日だけ**を登録し、当日のRole付与とお祝い投稿を自動化する公式Pluginです。

## プライバシー方針

- 保存するのはDiscord User ID、月、日のみです。
- 生年・年齢は保存しません。
- `/birthday remove` で本人が登録を削除できます。
- `/birthday me` で本人が保存内容を確認できます。

## コマンド

- `/birthday set month:<1-12> day:<1-31>`: 自分の誕生日を登録・更新します。
- `/birthday remove`: 自分の誕生日登録を削除します。
- `/birthday me`: 自分の登録内容を確認します。
- `/birthday next`: Guild timezone基準で次の誕生日を表示します。
- `/birthday list`: 登録済み誕生日を月日順で表示します。

`/birthday list`は登録数が多い場合でも後半を切り捨てず、1900文字以内の複数メッセージへ分割します。

## Config Studio

- `enabled`: Plugin全体の有効/無効
- `ephemeralResponses`: コマンド結果を本人だけへ表示
- `assignRole`: 誕生日当日のRole付与
- `birthdayRoleId`: 誕生日Role。Role PickerではBotが編集可能なRoleだけを選択します。
- `sendAnnouncement`: お祝い投稿の有効/無効
- `announcementChannelId`: お祝い投稿Channel
- `announcementMessage`: お祝い文。`{user}`を対象ユーザーのメンションへ置換します。
- `leapDayPolicy`: 非うるう年に2月29日生まれを扱う方法
  - `february-28`: 2月28日に祝う
  - `march-1`: 3月1日に祝う
  - `skip`: 非うるう年は自動処理しない

## Birthday Management

Guild管理者はHerta Studioの `/dashboard/guilds/[guildId]/birthday` からメンバーの誕生日を登録・更新・解除できます。

- Discord User Pickerで対象メンバーを選択します。
- 保存するのは既存コマンドと同じ月・日だけです。
- 2月29日は登録できます。
- 存在しない月日はAPI側でも拒否します。
- 管理者による登録・更新・解除はAudit Logへ記録します。
- 既存の`birthday_registrations`を再利用するため追加migrationはありません。

## timezone

日付境界はサーバープロセスのtimezoneではなく、`Guild.timezone`を使用します。Guildにtimezoneが保存されていない場合は`Asia/Tokyo`へフォールバックします。

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
3. Birthday Roleを付与
4. お祝いChannelへ投稿
5. Deliveryを`completed`として保存

誕生日終了後:

1. Hertaが過去に付与したBirthday Role deliveryを確認
2. 今日も誕生日のユーザーは除外
3. 付与時に記録したRole IDをdelivery kindから復元
4. Roleを解除
5. 解除deliveryを`completed`として保存

## 冪等性・障害復旧

Role付与、Role解除、お祝い投稿には一意のidempotency keyを使用します。同じGuild・User・日付・処理種別を複数回実行しても、完了済み処理は再実行しません。

処理中のまま2時間以上更新されていないdeliveryはstaleとして再試行可能に戻します。Bot再起動や一時的なDiscord API障害でも、次の周期で安全に回復できます。

## 2月29日

2月29日は有効な誕生日として登録できます。非うるう年の実行日はStudioの`leapDayPolicy`で明示的に決めます。

## 外部API

Birthday RoleはOpenAI APIやその他の有料AI APIを使用しません。`OPENAI_API_KEY`も不要です。
