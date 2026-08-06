# Moderation Plugin v2 observe-only自動検知

GitHub Issue #78の第1段階として、メッセージ本文を永続保存せずに誤検知率と処理量を確認するobserve-only検知基盤を追加します。

## 安全な初期状態

- `automaticMode`の既定値は`disabled`
- `observe`へ変更してもメッセージ削除、警告、タイムアウト、Kick、BANは実行しない
- Moderation Caseや検知履歴テーブルは作成しない
- ログへ本文、一致ワード、正規表現、招待コードを出力しない
- Bot、Webhook、system message、Plugin無効Guildは処理しない

Message Content IntentはBot全体の既存設定`DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true`で有効化します。Discord Developer Portal側でもMessage Content Intentを有効にしてください。

## 検知項目

| 種別 | 設定 | 動作 |
| --- | --- | --- |
| 完全一致 | `autoExactWords` | NFKC正規化、小文字化、空白正規化後の本文全体を比較 |
| 部分一致 | `autoContainsWords` | 正規化後本文に含まれるか比較 |
| 正規表現 | `autoRegexPatterns` | 最大20件、各120文字、`iu`フラグで評価 |
| 招待リンク | `autoInviteFilterEnabled` | `discord.gg`と`discord.com/invite`を検知 |
| 招待許可 | `autoInviteAllowlist` | 招待コード単位で検知対象外にする |
| 大量メンション | `autoMentionLimit` | User、Role、everyoneの合計数を評価 |
| 連投 | `autoBurstMessageLimit` | ユーザー単位のsliding windowで投稿数を評価 |
| 重複投稿 | `autoDuplicateMessageLimit` | 正規化本文のプロセス内fingerprintで重複数を評価 |

`autoMentionLimit`、`autoBurstMessageLimit`、`autoDuplicateMessageLimit`は`0`で無効です。

## 除外

- `autoExemptChannelIds`
- `autoExemptRoleIds`
- `autoExemptUserIds`

除外はGuild単位設定として適用します。他Guildの設定や投稿状態は参照しません。

## 正規表現の安全境界

以下は設定正規化時に除外します。

- 120文字を超える式
- 後方参照
- lookahead / lookbehind
- グループの外側へ量指定子を重ねる代表的なnested quantifier
- JavaScriptでコンパイルできない式

1メッセージあたり最大20式、本文は既定2000文字・最大4000文字に制限します。observe期間中に処理時間が増える場合は正規表現件数を減らしてください。

## 構造化ログ

検知時に保存する項目:

- Guild ID
- Channel ID
- User ID
- `detectionKind`
- 本文の文字数
- 観測数と閾値
- 設定配列内のrule index
- `mode=observe`

保存しない項目:

- メッセージ本文
- 一致した単語
- 正規表現文字列
- Discord招待コード
- 添付ファイル
- 前後の会話

## 段階的有効化

1. 1つの検証GuildだけでModeration Pluginを有効化する
2. `automaticMode=disabled`のまま既存の`/mod`操作を確認する
3. Word Filterを少数設定し`automaticMode=observe`へ変更する
4. Botログで`detectionKind`、件数、処理頻度を確認する
5. 除外Channel / Role / Userを調整する
6. 7日以上observeし、誤検知率とイベント量を記録する
7. 自動削除・自動処罰・Case連携は後続PRで個別opt-inとして実装する

## 緊急停止

StudioのPlugin設定で`automaticMode=disabled`へ戻します。Plugin Runtime EventによりGuild Runtimeが再同期され、MessageCreate handlerが外れます。即時停止が必要な場合はModeration Plugin自体を無効化します。

## このPRの対象外

- `messageUpdate`
- メッセージ削除
- 自動警告、タイムアウト、BAN
- Moderation Case作成
- DBへの検知履歴保存
- Studioの検知履歴・誤検知管理画面
- Rule Engine action実行

これらはobserve結果を確認後、GitHub Issue #78の後続フェーズで実装します。
