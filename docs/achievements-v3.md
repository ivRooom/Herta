# Achievements v3

Achievements v3では、既存の固定Achievementに加えてGuildごとのCustom Achievement Seriesを設定できます。

## Custom Achievement Series

- 1 Guildあたり最大25 Series
- 1 Seriesあたり最大10 Stage
- 1 Stageあたり最大8条件
- `ALL` / `ANY` 条件
- Badge / Emoji、Rarity、Badge Point、Secret設定
- Stageごとの解除通知Channel
- Stageごとの報酬Role

解除IDは `custom:<series-key>:<stage-key>` 形式で既存の `achievement_unlocks` に保存されます。

## 利用できる条件

- XP
- Messages
- Reactions Given / Received
- Voice time
- Minecraft activity time
- Poll votes
- Giveaway entries
- Event RSVP (Going)
- Suggestions / Accepted suggestions
- Community Challenge completions
- Season points

## 段階Achievement例

`chat-master` Seriesに以下のStageを作ることで、同じ活動を段階化できます。

- Bronze: Messages >= 100
- Silver: Messages >= 1,000
- Gold: Messages >= 10,000

既存のAchievementとCustom Achievementは一覧・進捗・解除履歴・Badge Leaderboardで共存します。
