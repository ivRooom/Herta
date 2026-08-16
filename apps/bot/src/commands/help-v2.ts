import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { CommandDefinition } from '@herta/shared';
import type { SlashCommand } from './registry.js';

const EMBED_FIELD_VALUE_LIMIT = 1_024;
const EMBED_DESCRIPTION_LIMIT = 4_096;
const HELP_DETAIL_LIMIT = 3_800;
const MAX_HELP_QUERY_LENGTH = 64;

let commandProvider: () => readonly SlashCommand[] = () => [];

export function configureHelpCommandProvider(provider: () => readonly SlashCommand[]): void {
  commandProvider = provider;
}

export function normalizeHelpCommandName(value: string): string | null {
  const normalized = value.trim().replace(/^\/+/, '').toLowerCase();
  if (!normalized || normalized.length > MAX_HELP_QUERY_LENGTH) return null;
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function uniqueSortedCommands(commands: readonly SlashCommand[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const command of commands) {
    byName.set(command.definition.name, command);
  }
  return [...byName.values()].sort((a, b) => a.definition.name.localeCompare(b.definition.name));
}

export function buildHelpOverviewFields(
  commands: readonly SlashCommand[],
): Array<{ name: string; value: string; inline: false }> {
  const lines = uniqueSortedCommands(commands).map(
    (command) => `\`/${command.definition.name}\` — ${command.definition.description}`,
  );

  if (lines.length === 0) {
    return [{ name: '利用可能なコマンド', value: '現在表示できるコマンドはありません。', inline: false }];
  }

  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > EMBED_FIELD_VALUE_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((value, index) => ({
    name: chunks.length === 1 ? '利用可能なコマンド' : `利用可能なコマンド ${index + 1}/${chunks.length}`,
    value,
    inline: false as const,
  }));
}

function optionUsage(option: NonNullable<CommandDefinition['options']>[number]): string {
  return option.required ? `<${option.name}>` : `[${option.name}]`;
}

function commandUsage(definition: CommandDefinition): string[] {
  if (definition.subcommands?.length) {
    return definition.subcommands.map((subcommand) => {
      const options = subcommand.options?.map(optionUsage).join(' ') ?? '';
      return `/${definition.name} ${subcommand.name}${options ? ` ${options}` : ''}`;
    });
  }

  const options = definition.options?.map(optionUsage).join(' ') ?? '';
  return [`/${definition.name}${options ? ` ${options}` : ''}`];
}

export function buildHelpCommandDetail(command: SlashCommand): string {
  const definition = command.definition;
  const parts = [definition.description, '', '**使い方**', ...commandUsage(definition).map((usage) => `\`${usage}\``)];

  if (definition.subcommands?.length) {
    parts.push('', '**サブコマンド**');
    for (const subcommand of definition.subcommands) {
      parts.push(`• \`${subcommand.name}\` — ${subcommand.description}`);
    }
  } else if (definition.options?.length) {
    parts.push('', '**オプション**');
    for (const option of definition.options) {
      const requirement = option.required ? '必須' : '任意';
      parts.push(`• \`${option.name}\` (${requirement}) — ${option.description}`);
    }
  }

  const detail = parts.join('\n');
  if (detail.length <= HELP_DETAIL_LIMIT) return detail;
  return `${detail.slice(0, HELP_DETAIL_LIMIT - 20)}\n…一部を省略しました`;
}

export function findHelpSuggestions(
  commands: readonly SlashCommand[],
  query: string,
  limit = 5,
): string[] {
  const normalized = normalizeHelpCommandName(query);
  if (!normalized) return [];

  const names = uniqueSortedCommands(commands).map((command) => command.definition.name);
  return names
    .filter((name) => name.startsWith(normalized) || name.includes(normalized))
    .slice(0, Math.max(0, limit));
}

export const helpV2Command: SlashCommand = {
  definition: {
    name: 'help',
    description: '利用できるCommand一覧または指定Commandの詳しい使い方を表示します',
    options: [
      {
        name: 'command',
        description: '詳しく確認するCommand名。例: color / activity / amidakuji',
        type: 'string',
      },
    ],
  },
  async execute(interaction) {
    const commands = commandProvider();
    const rawQuery = interaction.options.getString('command');

    if (rawQuery) {
      const name = normalizeHelpCommandName(rawQuery);
      if (!name) {
        await interaction.reply({
          content: 'Command名は英小文字・数字・`_`・`-`のみで指定してください。',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const command = commands.find((candidate) => candidate.definition.name === name);
      if (!command) {
        const suggestions = findHelpSuggestions(commands, name);
        await interaction.reply({
          content:
            suggestions.length > 0
              ? `指定されたCommandは見つかりません。候補: ${suggestions.map((candidate) => `\`/${candidate}\``).join(', ')}`
              : '指定されたCommandは見つかりません。`/help`で利用可能な一覧を確認してください。',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`/${command.definition.name}`)
        .setDescription(buildHelpCommandDetail(command).slice(0, EMBED_DESCRIPTION_LIMIT))
        .setColor(0x7c6df2)
        .setFooter({ text: '現在このサーバーで登録されているCommand定義を表示しています' });

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const fields = buildHelpOverviewFields(commands);
    const embed = new EmbedBuilder()
      .setTitle('Herta Command Help')
      .setDescription(
        '現在利用できるCommandを表示しています。詳しい使い方は `/help command:<コマンド名>` で確認できます。',
      )
      .setColor(0x7c6df2)
      .addFields(fields)
      .setFooter({ text: `${uniqueSortedCommands(commands).length} commands available` });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};
