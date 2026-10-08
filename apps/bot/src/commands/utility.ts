import { createHash, randomInt, randomUUID } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_TEAM_MEMBERS = 30;
const MAX_MEMBER_LENGTH = 30;
const MAX_TEAMS = 10;
const MAX_UUID_COUNT = 10;
const MAX_HASH_INPUT_LENGTH = 4_000;
const DISCORD_EPOCH = 1_420_070_400_000n;
const MAX_UNIX_SECONDS = 4_102_444_800;
const MAX_TRANSFORM_INPUT_LENGTH = 2_000;
const MAX_TRANSFORM_OUTPUT_LENGTH = 1_800;
const MAX_TEXTSTATS_INPUT_LENGTH = 4_000;
const MAX_JSON_INPUT_LENGTH = 2_000;
const MAX_JSON_OUTPUT_LENGTH = 1_800;
const MAX_DISCORD_CONTENT_LENGTH = 2_000;

const TIMESTAMP_STYLES = ['t', 'T', 'd', 'D', 'f', 'F', 'R'] as const;
type TimestampStyle = (typeof TIMESTAMP_STYLES)[number];
const HASH_ALGORITHMS = ['sha256', 'sha384', 'sha512'] as const;
type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

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

export function hashText(value: string, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(value, 'utf8').digest('hex');
}

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
    if (
      members.length < 2 ||
      members.length > MAX_TEAM_MEMBERS ||
      teamCount < 2 ||
      teamCount > MAX_TEAMS
    ) {
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
      .map(
        (team, index) => `**Team ${index + 1}**\n${team.map((member) => `• ${member}`).join('\n')}`,
      )
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
    if (
      unix < 0 ||
      unix > MAX_UNIX_SECONDS ||
      !TIMESTAMP_STYLES.includes(requestedStyle as TimestampStyle)
    ) {
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

export const hashCommand: SlashCommand = {
  definition: {
    name: 'hash',
    description: '入力テキストの暗号学的ハッシュを生成します',
    options: [
      {
        name: 'text',
        description: 'ハッシュ化するテキスト（最大4,000文字）',
        type: 'string',
        required: true,
      },
      {
        name: 'algorithm',
        description: 'ハッシュアルゴリズム（既定SHA-256）',
        type: 'string',
        choices: [
          { name: 'SHA-256', value: 'sha256' },
          { name: 'SHA-384', value: 'sha384' },
          { name: 'SHA-512', value: 'sha512' },
        ],
      },
    ],
  },
  async execute(interaction) {
    const text = interaction.options.getString('text', true);
    const requestedAlgorithm = interaction.options.getString('algorithm') ?? 'sha256';
    if (!text || text.length > MAX_HASH_INPUT_LENGTH) {
      await interaction.reply({
        content: 'textは1〜4,000文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!HASH_ALGORITHMS.includes(requestedAlgorithm as HashAlgorithm)) {
      await interaction.reply({
        content: '対応しているalgorithmを選択してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const algorithm = requestedAlgorithm as HashAlgorithm;
    const digest = hashText(text, algorithm);
    await interaction.reply({
      content: `**${algorithm.toUpperCase()}**\n\`${digest}\``,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export interface ParsedColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
  decimal: number;
}

export function parseColor(value: string): ParsedColor | null {
  const trimmed = value.trim();
  const hexMatch = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hexMatch) {
    const hex = `#${hexMatch[1]!.toUpperCase()}`;
    const decimal = Number.parseInt(hex.slice(1), 16);
    return {
      hex,
      rgb: {
        r: (decimal >> 16) & 0xff,
        g: (decimal >> 8) & 0xff,
        b: decimal & 0xff,
      },
      decimal,
    };
  }

  const rgbMatch = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(trimmed);
  if (!rgbMatch) return null;
  const [r, g, b] = rgbMatch.slice(1).map(Number) as [number, number, number];
  if ([r, g, b].some((channel) => channel < 0 || channel > 255)) return null;
  const decimal = (r << 16) | (g << 8) | b;
  return {
    hex: `#${decimal.toString(16).padStart(6, '0').toUpperCase()}`,
    rgb: { r, g, b },
    decimal,
  };
}

export function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function decodeBase64(value: string): string | null {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null;
  }
  try {
    const buffer = Buffer.from(normalized, 'base64');
    if (buffer.toString('base64') !== normalized) return null;
    const decoded = buffer.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(buffer)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

export function decodeUrlComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function analyzeText(value: string): {
  characters: number;
  codePoints: number;
  lines: number;
  words: number;
  utf8Bytes: number;
} {
  return {
    characters: value.length,
    codePoints: Array.from(value).length,
    lines: value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length,
    words: value.trim() ? value.trim().split(/\s+/u).length : 0,
    utf8Bytes: Buffer.byteLength(value, 'utf8'),
  };
}

function formatTransformResult(result: string): string | null {
  if (result.length > MAX_TRANSFORM_OUTPUT_LENGTH) return null;
  return `\`\`\`text\n${result.replace(/```/g, '``​`')}\n\`\`\``;
}

export const colorCommand: SlashCommand = {
  definition: {
    name: 'color',
    description: 'HEX / RGBカラー値を相互変換します',
    options: [
      {
        name: 'value',
        description: '#7C6DF2 または rgb(124,109,242)',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const value = interaction.options.getString('value', true);
    const color = parseColor(value);
    if (!color) {
      await interaction.reply({
        content: 'HEX（例: `#7C6DF2`）またはRGB（例: `rgb(124,109,242)`）を指定してください。',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.reply({
      content: [
        `HEX: \`${color.hex}\``,
        `RGB: \`rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})\``,
        `Decimal: \`${color.decimal}\``,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const base64Command: SlashCommand = {
  definition: {
    name: 'base64',
    description: 'UTF-8テキストをBase64へエンコード・デコードします',
    options: [
      {
        name: 'mode',
        description: '処理を選択',
        type: 'string',
        required: true,
        choices: [
          { name: 'Encode', value: 'encode' },
          { name: 'Decode', value: 'decode' },
        ],
      },
      {
        name: 'text',
        description: '変換するテキスト（最大2,000文字）',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const mode = interaction.options.getString('mode', true);
    const text = interaction.options.getString('text', true);
    if (!text || text.length > MAX_TRANSFORM_INPUT_LENGTH) {
      await interaction.reply({
        content: 'textは1〜2,000文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const result =
      mode === 'encode' ? encodeBase64(text) : mode === 'decode' ? decodeBase64(text) : null;
    if (result === null) {
      await interaction.reply({
        content: '有効なmodeとUTF-8として復元可能なBase64文字列を指定してください。',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const content = formatTransformResult(result);
    if (!content) {
      await interaction.reply({
        content: '変換結果がDiscordのメッセージ上限を超えます。入力を短くしてください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const urlCommand: SlashCommand = {
  definition: {
    name: 'url',
    description: 'URL componentをエンコード・デコードします',
    options: [
      {
        name: 'mode',
        description: '処理を選択',
        type: 'string',
        required: true,
        choices: [
          { name: 'Encode', value: 'encode' },
          { name: 'Decode', value: 'decode' },
        ],
      },
      {
        name: 'text',
        description: '変換するテキスト（最大2,000文字）',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const mode = interaction.options.getString('mode', true);
    const text = interaction.options.getString('text', true);
    if (!text || text.length > MAX_TRANSFORM_INPUT_LENGTH) {
      await interaction.reply({
        content: 'textは1〜2,000文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const result =
      mode === 'encode'
        ? encodeUrlComponent(text)
        : mode === 'decode'
          ? decodeUrlComponent(text)
          : null;
    if (result === null) {
      await interaction.reply({
        content: '有効なmodeとURL component文字列を指定してください。',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const content = formatTransformResult(result);
    if (!content) {
      await interaction.reply({
        content: '変換結果がDiscordのメッセージ上限を超えます。入力を短くしてください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export const textstatsCommand: SlashCommand = {
  definition: {
    name: 'textstats',
    description: 'テキストの文字数・行数・単語数・UTF-8バイト数を集計します',
    options: [
      {
        name: 'text',
        description: '解析するテキスト（最大4,000文字）',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const text = interaction.options.getString('text', true);
    if (!text || text.length > MAX_TEXTSTATS_INPUT_LENGTH) {
      await interaction.reply({
        content: 'textは1〜4,000文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const stats = analyzeText(text);
    await interaction.reply({
      content: [
        `UTF-16 code units: **${stats.characters.toLocaleString('ja-JP')}**`,
        `Unicode code points: **${stats.codePoints.toLocaleString('ja-JP')}**`,
        `行数: **${stats.lines.toLocaleString('ja-JP')}**`,
        `単語数: **${stats.words.toLocaleString('ja-JP')}**`,
        `UTF-8 bytes: **${stats.utf8Bytes.toLocaleString('ja-JP')}**`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export type JsonParseResult = { ok: true; value: unknown } | { ok: false };

export function parseJson(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

export function jsonValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isJsonWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r';
}

export function minifyJsonText(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (!isJsonWhitespace(character)) result += character;
  }

  return result;
}

export function prettyJsonText(value: string): string {
  const minified = minifyJsonText(value);
  let result = '';
  let indent = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < minified.length; index += 1) {
    const character = minified[index] ?? '';

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === '{' || character === '[') {
      result += character;
      indent += 1;
      const closing = character === '{' ? '}' : ']';
      if (minified[index + 1] !== closing) result += `\n${'  '.repeat(indent)}`;
      continue;
    }

    if (character === '}' || character === ']') {
      indent = Math.max(0, indent - 1);
      const opening = character === '}' ? '{' : '[';
      if (minified[index - 1] !== opening) result += `\n${'  '.repeat(indent)}`;
      result += character;
      continue;
    }

    if (character === ',') {
      result += `,\n${'  '.repeat(indent)}`;
      continue;
    }

    if (character === ':') {
      result += ': ';
      continue;
    }

    result += character;
  }

  return result;
}

export function formatJsonResult(value: string, pretty: boolean): string | null {
  const formatted = pretty ? prettyJsonText(value) : minifyJsonText(value);
  const safeJson = formatted.replace(/```/g, '\\u0060\\u0060\\u0060');
  if (safeJson.length > MAX_JSON_OUTPUT_LENGTH) return null;

  const content = `\`\`\`json\n${safeJson}\n\`\`\``;
  return content.length <= MAX_DISCORD_CONTENT_LENGTH ? content : null;
}

async function reply(
  interaction: Parameters<SlashCommand['execute']>[0],
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export const jsonCommand: SlashCommand = {
  definition: {
    name: 'json',
    description: 'JSONを検証・整形・圧縮します',
    subcommands: [
      {
        name: 'validate',
        description: 'JSONとして有効か検証します',
        options: [
          {
            name: 'text',
            description: '検証するJSON（最大2,000文字）',
            type: 'string',
            required: true,
          },
        ],
      },
      {
        name: 'pretty',
        description: 'JSONを2スペースインデントで整形します',
        options: [
          {
            name: 'text',
            description: '整形するJSON（最大2,000文字）',
            type: 'string',
            required: true,
          },
        ],
      },
      {
        name: 'minify',
        description: 'JSONから不要な空白を除去します',
        options: [
          {
            name: 'text',
            description: '圧縮するJSON（最大2,000文字）',
            type: 'string',
            required: true,
          },
        ],
      },
    ],
  },
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const text = interaction.options.getString('text', true);
    if (!text.trim() || text.length > MAX_JSON_INPUT_LENGTH) {
      await reply(interaction, 'textは1〜2,000文字のJSONで入力してください。');
      return;
    }

    const parsed = parseJson(text);
    if (!parsed.ok) {
      await reply(
        interaction,
        '有効なJSONではありません。引用符・カンマ・括弧を確認してください。',
      );
      return;
    }

    if (subcommand === 'validate') {
      await reply(
        interaction,
        `✅ 有効なJSONです。トップレベル型: \`${jsonValueType(parsed.value)}\``,
      );
      return;
    }

    if (subcommand !== 'pretty' && subcommand !== 'minify') {
      await reply(interaction, '不明なJSON操作です。');
      return;
    }

    const content = formatJsonResult(text, subcommand === 'pretty');
    if (!content) {
      await reply(
        interaction,
        '整形結果がDiscordのメッセージ上限を超えます。入力を短くしてください。',
      );
      return;
    }
    await reply(interaction, content);
  },
};

export const coreUtilityCommands: SlashCommand[] = [
  teamsCommand,
  uuidCommand,
  timestampCommand,
  snowflakeCommand,
  hashCommand,
  colorCommand,
  base64Command,
  urlCommand,
  textstatsCommand,
  jsonCommand,
];
