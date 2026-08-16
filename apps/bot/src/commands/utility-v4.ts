import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_TRANSFORM_INPUT_LENGTH = 2_000;
const MAX_TRANSFORM_OUTPUT_LENGTH = 1_800;
const MAX_TEXTSTATS_INPUT_LENGTH = 4_000;

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
  return `\`\`\`text\n${result.replace(/```/g, '``\u200b`')}\n\`\`\``;
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

export const coreUtilityV4Commands: SlashCommand[] = [
  colorCommand,
  base64Command,
  urlCommand,
  textstatsCommand,
];
