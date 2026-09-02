# Herta AI Role Mention Trigger

Herta AIをDiscord Role mentionから呼び出す場合のproduction運用手順です。Role IDはコードへ固定せず、GuildごとのHerta AI Plugin config `triggerRoleId`としてStudioから選択します。

## Security boundary

- `triggerRoleId`は単一のDiscord Roleだけを許可する
- candidate化にはDiscord mention metadataと本文中のliteral `<@&roleId>`の両方を要求する
- configured Role以外のRole mentionは無視する
- mention文字列だけをspoofしても処理しない
- bot / webhook / self messageは無視する
- verified Role mention tokenはproviderへ送るuser inputから除去する
- provider / model / reasoning / Runtime SecretはGuild Plugin configへ保存しない

## Message Content Intentが必須

DiscordはBot自身へのapp mentionとは異なり、Roleだけをmentionした通常Guild messageについて、Message Content Intentが無効なBotへ本文を提供しません。そのためRole mention triggerを使うproductionでは、次の2箇所を**両方**有効化する必要があります。

1. Discord Developer Portal → Herta Application → Bot → Privileged Gateway Intents → **Message Content Intent = ON**
2. production runtime `.env.production` → `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true`

Repositoryのproduction defaultは意図的に`false`のまま維持します。Developer Portal側が無効な状態でruntimeだけを先に`true`へすると、Discord gateway接続がdisallowed intentで失敗し得るためです。

必ず **Developer Portal → runtime env → Bot recreate → Studio Role設定** の順で実施します。

Roleが設定済みなのにruntime側Message Content Intentが無効な場合、BotはRole IDそのものやmessage本文をlogせず、設定不足を示すsafe warningだけを出します。

## Production target

Issue #354の限定production acceptanceでは次だけを対象にします。

- Guild: `いゔる。ーむ`
- Guild ID: `964326043420872704`
- E2E channel: `#コンソール`
- Channel ID: `1175075504940908635`
- AI trigger Role ID: `1534857044589547662`

対象外GuildへRole triggerを設定しません。

## Studio設定

Message Content Intent有効化とBot recreateが完了した後、Studioの対象GuildでHerta AI Pluginを開きます。

1. Herta AI Pluginを有効化
2. `GuildでHerta AIを利用する`をON
3. `AIを呼び出すRole`でRole `1534857044589547662`を選択
4. 保存
5. 対象外Guildでは`triggerRoleId`を未設定のまま維持

Studioは既存のschema-driven `discord-role` single pickerを使用し、mention可能なRoleだけを選択対象にします。

## Production E2E

`#コンソール`だけで確認します。

- configured Role mention + ordinary question → 1回だけAI reply
- configured Role mention + detailed question → typing indicator後に1回だけAI reply
- configured Role以外のRole mention → AI処理しない
- Role mention文字列のspoof → AI処理しない
- Role mentionだけで本文なし → AI処理しない
- `@Herta`本人mention →従来どおり処理
- verified Herta direct reply →従来どおり処理

Productionでintent確認のために権限破壊や他Guildへのテストmessageを送信しません。

## Rollback

Role triggerだけを停止する場合は、対象GuildのHerta AI Plugin設定で`AIを呼び出すRole`を未設定へ戻します。

Message Content Intent自体も不要になった場合は、Role triggerを解除した後にproduction runtimeを`DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false`へ戻してBotをrecreateし、必要に応じてDeveloper Portal側もOFFへ戻します。

AI全体の緊急停止は既存のIssue #354 rollout手順どおり、Guild opt-out → global AI gate OFF → kill switchを使用します。
