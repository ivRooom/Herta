import {
  DailyContentValidationError,
  normalizeMessageStudioEmbed,
  type MessageStudioEmbed,
} from './config.js';

export interface DiscordApiEmbed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface DiscordMessageReference {
  guildId: string;
  channelId: string;
  messageId: string;
}

const MESSAGE_URL_PATTERN =
  /^https?:\/\/(?:(?:www|canary|ptb)\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:\?.*)?$/i;

const WEEKDAY_ALIASES = new Map<string, number>([
  ['1', 1],
  ['月', 1],
  ['月曜', 1],
  ['月曜日', 1],
  ['mon', 1],
  ['monday', 1],
  ['2', 2],
  ['火', 2],
  ['火曜', 2],
  ['火曜日', 2],
  ['tue', 2],
  ['tuesday', 2],
  ['3', 3],
  ['水', 3],
  ['水曜', 3],
  ['水曜日', 3],
  ['wed', 3],
  ['wednesday', 3],
  ['4', 4],
  ['木', 4],
  ['木曜', 4],
  ['木曜日', 4],
  ['thu', 4],
  ['thursday', 4],
  ['5', 5],
  ['金', 5],
  ['金曜', 5],
  ['金曜日', 5],
  ['fri', 5],
  ['friday', 5],
  ['6', 6],
  ['土', 6],
  ['土曜', 6],
  ['土曜日', 6],
  ['sat', 6],
  ['saturday', 6],
  ['7', 7],
  ['日', 7],
  ['日曜', 7],
  ['日曜日', 7],
  ['sun', 7],
  ['sunday', 7],
]);

export function toDiscordApiEmbed(input: MessageStudioEmbed | null): DiscordApiEmbed | null {
  // 保存前にPlugin設定に応じたmention検証を済ませているため、Workerでの再変換では
  // user mentionを許容して構造・長さ・URLだけを再検証する。
  const embed = normalizeMessageStudioEmbed(input, true);
  if (!embed) return null;
  const color = embed.color ? Number.parseInt(embed.color.slice(1), 16) : undefined;
  return {
    ...(embed.title ? { title: embed.title } : {}),
    ...(embed.description ? { description: embed.description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(embed.imageUrl ? { image: { url: embed.imageUrl } } : {}),
    ...(embed.thumbnailUrl ? { thumbnail: { url: embed.thumbnailUrl } } : {}),
    ...(embed.footerText ? { footer: { text: embed.footerText } } : {}),
    ...(embed.fields?.length
      ? {
          fields: embed.fields.map((field) => ({
            name: field.name,
            value: field.value,
            ...(field.inline ? { inline: true } : {}),
          })),
        }
      : {}),
  };
}

export function parseDiscordMessageUrl(value: string): DiscordMessageReference {
  const match = MESSAGE_URL_PATTERN.exec(value.trim());
  if (!match) {
    throw new DailyContentValidationError('DiscordメッセージURLの形式が不正です');
  }
  return { guildId: match[1]!, channelId: match[2]!, messageId: match[3]! };
}

export function parseMessageStudioWeekdays(value: string | null | undefined): number[] {
  if (!value?.trim()) return [];
  const parts = value
    .split(/[\s,、，・/]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const days: number[] = [];
  for (const part of parts) {
    const day = WEEKDAY_ALIASES.get(part);
    if (!day) throw new DailyContentValidationError(`曜日「${part}」を解釈できません`);
    days.push(day);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

export function formatMessageStudioWeekdays(days: readonly number[]): string {
  const labels = ['月', '火', '水', '木', '金', '土', '日'];
  return days.map((day) => labels[day - 1] ?? '?').join('・');
}

export function safeEmbedFromJson(value: unknown): MessageStudioEmbed | null {
  try {
    return normalizeMessageStudioEmbed(value, true);
  } catch {
    return null;
  }
}
