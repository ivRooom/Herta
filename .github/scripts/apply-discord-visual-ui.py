from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f'{path}: regex expected exactly one match, got {count}')
    path.write_text(updated, encoding='utf-8')


automatic = Path('plugins/moderation/src/automatic-runtime.ts')
plugin = Path('plugins/moderation/src/plugin.ts')

replace_once(
    automatic,
    "import {\n  createModerationCase,\n  type ModerationCaseAction,\n  type ModerationPrismaClient,\n} from './service.js';\n",
    "import {\n  createModerationCase,\n  type ModerationCaseAction,\n  type ModerationPrismaClient,\n} from './service.js';\nimport {\n  buildAutomaticAlertEmbed,\n  buildAutomaticWarningEmbed,\n  type DiscordVisualMessagePayload,\n} from './discord-ui.js';\n",
)

replace_once(
    automatic,
    "interface ModerationAutomaticUser {\n  id: string;\n  bot: boolean;\n  send(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;\n}\n",
    "interface ModerationAutomaticUser {\n  id: string;\n  bot: boolean;\n  send(options: DiscordVisualMessagePayload): Promise<unknown>;\n}\n",
)

replace_once(
    automatic,
    "interface ModerationTextChannel {\n  isTextBased(): boolean;\n  send(options: {\n    content: string;\n    allowedMentions: { parse: []; roles?: string[] };\n  }): Promise<unknown>;\n}\n",
    "interface ModerationTextChannel {\n  isTextBased(): boolean;\n  send(options: DiscordVisualMessagePayload): Promise<unknown>;\n}\n",
)

replace_once(
    automatic,
    "  await message.author.send({ content, allowedMentions: { parse: [] } });\n",
    "  await message.author.send({\n    embeds: [buildAutomaticWarningEmbed(policy, content)],\n    allowedMentions: { parse: [] },\n  });\n",
)

new_alert = """  const jumpUrl = `https://discord.com/channels/${context.guildId}/${message.channelId}/${message.id}`;
  const mentionPrefix = config.autoAlertMentionRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  const embed = buildAutomaticAlertEmbed({
    severity: selected.policy.severity,
    action: selected.policy.action,
    targetUserId: message.author.id,
    channelId: message.channelId,
    matchedSelectors: findings.map((item) => item.policy.selector),
    jumpUrl,
    createdTimestamp: message.createdTimestamp,
    excerpt: config.autoAlertIncludeExcerpt ? sanitizeExcerpt(message.content) : null,
    failure,
    errorMessage: failure ? formatError(error) : null,
  });

  await channel.send({
    ...(mentionPrefix ? { content: mentionPrefix } : {}),
    embeds: [embed],
    allowedMentions: { parse: [], roles: config.autoAlertMentionRoleIds },
  });
"""
replace_regex_once(
    automatic,
    r"  const severity = selected\.policy\.severity\.toUpperCase\(\);.*?  await channel\.send\(\{\n    content: lines\.join\('\\n'\),\n    allowedMentions: \{ parse: \[\], roles: config\.autoAlertMentionRoleIds \},\n  \}\);\n",
    new_alert,
)

replace_once(
    plugin,
    "import {\n  createModerationCase,\n  getModerationCase,\n  listModerationCases,\n  type ModerationAction,\n  type ModerationCaseAction,\n  type ModerationCaseRecord,\n  type ModerationPrismaClient,\n} from './service.js';\n",
    "import {\n  createModerationCase,\n  getModerationCase,\n  listModerationCases,\n  type ModerationAction,\n  type ModerationCaseRecord,\n  type ModerationPrismaClient,\n} from './service.js';\nimport {\n  actionLabel,\n  buildModerationCaseEmbed,\n  buildModerationHistoryEmbed,\n  buildModerationStatusEmbed,\n  type DiscordEmbedPayload,\n  type DiscordVisualMessagePayload,\n} from './discord-ui.js';\n",
)

replace_once(plugin, "const MAX_RESPONSE_LENGTH = 1900;\n", "")
replace_once(
    plugin,
    "interface ModerationReplyOptions {\n  content: string;\n  flags?: number;\n  allowedMentions: { parse: [] };\n}\n",
    "type ModerationReplyOptions = DiscordVisualMessagePayload;\n",
)

replace_once(
    plugin,
    "        moderationCase ? formatCase(moderationCase) : `Case #${caseNumber} は見つかりません`,\n",
    "        moderationCase\n          ? buildModerationCaseEmbed(moderationCase)\n          : buildModerationStatusEmbed({\n              title: 'Caseが見つかりません',\n              description: `Case #${caseNumber} は見つかりません。`,\n              variant: 'warning',\n            }),\n",
)

replace_once(
    plugin,
    "        formatHistory(target.id, result.items, result.page, result.totalPages),\n",
    "        buildModerationHistoryEmbed({\n          targetUserId: target.id,\n          items: result.items,\n          page: result.page,\n          totalPages: result.totalPages,\n        }),\n",
)

replace_once(
    plugin,
    "        'Discord上の操作に失敗しました。Bot権限とロール階層を確認してください',\n",
    "        buildModerationStatusEmbed({\n          title: '❌ Discord上の操作に失敗',\n          description: 'Bot権限・ロール階層・対象ユーザーの状態を確認してください。',\n          variant: 'failed',\n        }),\n",
)

replace_once(
    plugin,
    "      `Case #${moderationCase.caseNumber} として${actionLabel(action)}を記録しました`,\n",
    "      buildModerationStatusEmbed({\n        title: '✅ Moderation操作を記録しました',\n        description: `Case #${moderationCase.caseNumber} として「${actionLabel(action)}」を記録しました。`,\n        variant: 'case',\n      }),\n",
)

replace_once(
    plugin,
    "      await respond(interaction, error.message, true);\n",
    "      await respond(\n        interaction,\n        buildModerationStatusEmbed({\n          title: '⚠️ 操作を実行できません',\n          description: error.message,\n          variant: 'warning',\n        }),\n        true,\n      );\n",
)

replace_once(
    plugin,
    "    await respond(interaction, 'Moderation Commandの実行中にエラーが発生しました', true);\n",
    "    await respond(\n      interaction,\n      buildModerationStatusEmbed({\n        title: '❌ Moderationエラー',\n        description: 'Moderation Commandの実行中にエラーが発生しました。',\n        variant: 'failed',\n      }),\n      true,\n    );\n",
)

replace_once(
    plugin,
    "    await user.send({\n      content: formatTargetNotification(moderationCase),\n      allowedMentions: { parse: [] },\n    });\n",
    "    await user.send({\n      embeds: [buildModerationCaseEmbed(moderationCase, { targetNotification: true })],\n      allowedMentions: { parse: [] },\n    });\n",
)

replace_once(
    plugin,
    "    await channel.send({\n      content: formatCase(moderationCase),\n      allowedMentions: { parse: [] },\n    });\n",
    "    await channel.send({\n      embeds: [buildModerationCaseEmbed(moderationCase)],\n      allowedMentions: { parse: [] },\n    });\n",
)

text = plugin.read_text(encoding='utf-8')
start = text.index('function formatCase(')
end = text.index('function normalizeAction(')
plugin.write_text(text[:start] + text[end:], encoding='utf-8')

old_respond = """async function respond(
  interaction: ModerationCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  const options: ModerationReplyOptions = {
    content: truncate(content, MAX_RESPONSE_LENGTH),
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}
"""
new_respond = """async function respond(
  interaction: ModerationCommandInteraction,
  message: string | DiscordEmbedPayload,
  ephemeral: boolean,
): Promise<void> {
  const embed =
    typeof message === 'string'
      ? buildModerationStatusEmbed({
          title: 'Herta Moderation',
          description: message,
          variant: 'info',
        })
      : message;
  const options: ModerationReplyOptions = {
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}
"""
replace_once(plugin, old_respond, new_respond)

text = plugin.read_text(encoding='utf-8')
truncate_fn = """function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

"""
if truncate_fn in text:
    text = text.replace(truncate_fn, '', 1)
plugin.write_text(text, encoding='utf-8')
