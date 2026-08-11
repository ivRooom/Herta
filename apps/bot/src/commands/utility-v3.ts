import { randomUUID, randomInt } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_TEAM_MEMBERS = 30;
const MAX_MEMBER_LENGTH = 30;
const MAX_TEAMS = 10;
const MAX_UUID_COUNT = 10;
const DISCORD_EPOCH = 1_420_070_400_000n;
const MAX_UNIX_SECONDS = 4_102_444_800;

const TIMESTAMP_STYLES = ['t', 'T', 'd', 'D', 'f', 'F', 'R'] as const;
type TimestampStyle = (typeof TIMESTAMP_STYLES)[number];

export function parseTeamMembers(value: string): string[] {
  return value
    .split(/[\n,、]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function splitIntoTeams<T>(values: readonly T[], teamCount: number): T[][] {
  const normalizedCount = Math.max(2, Math.min(MAX_TEAMS, Math.trunc(teamCount)));
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  const teams = Array.from({ length: normalizedCount }, () => [] as T[]);
  shuffled.forEach((value, index) => teams[index % normalizedCount]!.push(value));
  return teams;
}

export function discordSnowflakeCreatedAt(id: string): Date | null {
  if (!/^\d{1,20}$/.test(id)) return null;
  try {
    const value = BigInt(id);
    if (value <= 0n) return null;
    const timestamp = (value >> 22n) + DISCORD_EPOCH;
    const millis = Number(timestamp);
    if (!Number.isSafeInteger(millis)) return null;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

export function formatDiscordTimestamp(unixSeconds: number, style: TimestampStyle): string {
  return `<t:${Math.trunc(unixSeconds)}:${style}>`;
}

export const utilitiesCommand: SlashCommand = {
  definition: {
    name: 'utilities',
    description: '追加のCore Utilityコマンド一覧を表示します',
  },
  async execute(interaction) {
    await interaction.reply({
      content: [
        '**Core Utility v3**',
        '`/teams members teams` — メンバーをランダムにチーム分け',
        '`/uuid [count]` — UUID v4を生成',
        '`/timestamp unix [style]` — Discord時刻表記を生成',
        '`/snowflake id` — Discord IDの作成日時を解析',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const teamsCommand: SlashCommand = {
  definition: {
    name: 'teams',
    description: '入力したメンバーをランダムにチーム分けします',
    options: [
      {
        name: 'members',
        description: 'カンマまたは改行区切りで2〜30人を入力',
        type: 'string',
        required: true,
      },
      {
        name: 'teams',
        description: 'チーム数（2〜10）',
        type: 'integer',
        required: true,
        minValue: 2,
        maxValue: 10,
      },
    ],
  },
  async execute(interaction) {
    const members = parseTeamMembers(interaction.options.getString('members', true));
    const teamCount = interaction.options.getInteger('teams', true);
    if (members.length < 2 || members.length > MAX_TEAM_MEMBERS || teamCount < 2 || teamCount > MAX_TEAMS) {
      await interaction.reply({
        content: 'メンバーは2〜30人、チーム数は2〜10で指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (members.some((member) => member.length > MAX_MEMBER_LENGTH)) {
      await interaction.reply({
        content: '各メンバー名は30文字以内で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (teamCount > members.length) {
      await interaction.reply({
        content: 'チーム数はメンバー数以下にしてください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const teams = splitIntoTeams(members, teamCount);
    const content = teams
      .map((team, index) => `**Team ${index + 1}**\n${team.map((member) => `• ${member}`).join('\n')}`)
      .join('\n\n');
    await interaction.reply({ content, allowedMentions: { parse: [] } });
  },
};

export const uuidCommand: SlashCommand = {
  definition: {
    name: 'uuid',
    description: 'UUID v4を生成します',
    options: [
      {
        name: 'count',
        description: '生成数（1〜10、既定1）',
        type: 'integer',
        minValue: 1,
        maxValue: 10,
      },
    ],
  },
  async execute(interaction) {
    const count = interaction.options.getInteger('count') ?? 1;
    if (count < 1 || count > MAX_UUID_COUNT) {
      await interaction.reply({
        content: 'countは1〜10で指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: Array.from({ length: count }, () => `\`${randomUUID()}\``).join('\n'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const timestampCommand: SlashCommand = {
  definition: {
    name: 'timestamp',
    description: 'Unix秒からDiscord時刻表記を生成します',
    options: [
      {
        name: 'unix',
        description: 'Unix timestamp（秒）',
        type: 'integer',
        required: true,
        minValue: 0,
        maxValue: MAX_UNIX_SECONDS,
      },
      {
        name: 'style',
        description: 'Discord表示形式',
        type: 'string',
        choices: TIMESTAMP_STYLES.map((style) => ({ name: style, value: style })),
      },
    ],
  },
  async execute(interaction) {
    const unix = interaction.options.getInteger('unix', true);
    const requestedStyle = interaction.options.getString('style') ?? 'F';
    if (unix < 0 || unix > MAX_UNIX_SECONDS || !TIMESTAMP_STYLES.includes(requestedStyle as TimestampStyle)) {
      await interaction.reply({
        content: 'Unix秒またはstyleが有効範囲外です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const style = requestedStyle as TimestampStyle;
    const rendered = formatDiscordTimestamp(unix, style);
    await interaction.reply({
      content: `Discord表記: \`${rendered}\`\nプレビュー: ${rendered}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const snowflakeCommand: SlashCommand = {
  definition: {
    name: 'snowflake',
    description: 'Discord Snowflake IDから作成日時を解析します',
    options: [
      {
        name: 'id',
        description: 'DiscordのUser / Role / Channel / Message ID',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const id = interaction.options.getString('id', true).trim();
    const createdAt = discordSnowflakeCreatedAt(id);
    if (!createdAt) {
      await interaction.reply({
        content: '有効なDiscord Snowflake IDを指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const unix = Math.floor(createdAt.getTime() / 1000);
    await interaction.reply({
      content: `ID: \`${id}\`\n作成日時: <t:${unix}:F>\n相対時刻: <t:${unix}:R>`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const coreUtilityV3Commands: SlashCommand[] = [
  utilitiesCommand,
  teamsCommand,
  uuidCommand,
  timestampCommand,
  snowflakeCommand,
];
