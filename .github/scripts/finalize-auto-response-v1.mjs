import { readFileSync, writeFileSync } from 'node:fs';

function replaceOrThrow(path, before, after) {
  const current = readFileSync(path, 'utf8');
  if (!current.includes(before)) throw new Error(`${path}: expected block was not found`);
  writeFileSync(path, current.replace(before, after));
}

replaceOrThrow(
  'plugins/auto-response/src/service.ts',
  `  assertDiscordId,
  assertRuleId,
  normalizeAutoResponseRuleInput,`,
  `  AutoResponseValidationError,
  assertDiscordId,
  assertRuleId,
  normalizeAutoResponseRuleInput,`,
);
replaceOrThrow(
  'plugins/auto-response/src/service.ts',
  '      throw new Error(`自動応答ルールは最大${input.config.maxRules}件までです`);',
  '      throw new AutoResponseValidationError(`自動応答ルールは最大${input.config.maxRules}件までです`);',
);

replaceOrThrow(
  'plugins/auto-response/src/plugin.ts',
  `const VIEW_CHANNEL_PERMISSION = 1024n;
const SEND_MESSAGES_PERMISSION = 2048n;`,
  `const VIEW_CHANNEL_PERMISSION = 1024n;
const SEND_MESSAGES_PERMISSION = 2048n;
const EMBED_LINKS_PERMISSION = 16384n;`,
);
replaceOrThrow(
  'plugins/auto-response/src/plugin.ts',
  '      assertBotCanRespond(message);',
  '      assertBotCanRespond(message, rule.responseType);',
);
replaceOrThrow(
  'plugins/auto-response/src/plugin.ts',
  `function assertBotCanRespond(message: AutoResponseMessage): void {`,
  `function assertBotCanRespond(
  message: AutoResponseMessage,
  responseType: AutoResponseRuleRecord['responseType'],
): void {`,
);
replaceOrThrow(
  'plugins/auto-response/src/plugin.ts',
  `  if (
    !permissions?.has(VIEW_CHANNEL_PERMISSION) ||
    !permissions.has(SEND_MESSAGES_PERMISSION)
  ) {
    throw new Error('AutoResponseBotPermissionDenied');
  }`,
  `  if (
    !permissions?.has(VIEW_CHANNEL_PERMISSION) ||
    !permissions.has(SEND_MESSAGES_PERMISSION) ||
    (responseType === 'embed' && !permissions.has(EMBED_LINKS_PERMISSION))
  ) {
    throw new Error('AutoResponseBotPermissionDenied');
  }`,
);

replaceOrThrow(
  'apps/studio/src/app/globals.css',
  `@layer base {`,
  `@layer components {
  .input {
    @apply w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring;
  }
}

@layer base {`,
);

replaceOrThrow(
  'README.md',
  `- 現在の Slash Command Runtime が要求する Gateway Intent は \`Guilds\` のみです
- \`SIGINT\` / \`SIGTERM\` で graceful shutdown します`,
  `- 通常は \`Guilds\` Intentだけで起動します
- Auto Responseを使う場合はDeveloper PortalでMessage Content Intentを有効化し、\`DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true\`を設定します
- Message Content Intentが無効な場合、メッセージ系Pluginは処理されません
- \`SIGINT\` / \`SIGTERM\` で graceful shutdown します`,
);

replaceOrThrow(
  'docs/ENVIRONMENT_VARIABLES.md',
  `| \`DISCORD_BOT_TOKEN\`     | Yes  | Bot トークン                                  | Bot                      |
| \`DISCORD_PUBLIC_KEY\`    | -    | Interactions 用公開鍵                         | Bot                      |`,
  `| \`DISCORD_BOT_TOKEN\`     | Yes  | Bot トークン                                  | Bot                      |
| \`DISCORD_ENABLE_MESSAGE_CONTENT_INTENT\` | - | Auto Response用Message Content Intentを有効化 | Bot（既定: \`false\`） |
| \`DISCORD_PUBLIC_KEY\`    | -    | Interactions 用公開鍵                         | Bot                      |`,
);
replaceOrThrow(
  'docs/ENVIRONMENT_VARIABLES.md',
  `> OAuth2 スコープは \`identify\` \`email\` \`guilds\` が必要です。詳細は [AUTH.md](./AUTH.md)。`,
  `> OAuth2 スコープは \`identify\` \`email\` \`guilds\` が必要です。詳細は [AUTH.md](./AUTH.md)。
>
> Auto Responseを利用する場合はDiscord Developer PortalでMessage Content Intentを有効化した後、
> \`DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true\`へ変更してください。通常運用では\`false\`のままです。`,
);

replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  `Runtimeは送信前にView ChannelとSend Messagesを確認します。権限不足はルール本文を含めず失敗メトリクスへ記録します。`,
  `Runtimeは送信前にView ChannelとSend Messagesを確認し、Embed応答ではEmbed Linksも確認します。権限不足はルール本文を含めず失敗メトリクスへ記録します。`,
);
replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  `送信直前にRuleの\`lastTriggeredAt\`を更新します。Discord API送信が失敗した場合も短時間の連続再試行を防ぐためCooldownは維持し、失敗メトリクスを記録します。`,
  `送信直前にRuleの\`lastTriggeredAt\`を更新します。Discord API送信が失敗した場合も短時間の連続再試行を防ぐためCooldownは維持し、失敗メトリクスを記録します。Studioで変更したルールはRuntimeの最大10秒キャッシュ後に反映されます。`,
);

console.log('Auto Response v1 final consistency changes applied.');
