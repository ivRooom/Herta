import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_JSON_INPUT_LENGTH = 2_000;
const MAX_JSON_OUTPUT_LENGTH = 1_800;
const MAX_DISCORD_CONTENT_LENGTH = 2_000;

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

export const coreUtilityV5Commands: SlashCommand[] = [jsonCommand];
