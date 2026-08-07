import { describe, expect, it } from 'vitest';
import {
  DISCORD_EMBED_LIMITS,
  HERTA_DISCORD_COLORS,
  buildDiscordVisualAssetUrl,
  buildDiscordVisualEmbed,
  normalizeDiscordEmbedFields,
  safeDiscordMentions,
} from './index.js';

describe('Discord Visual Kit', () => {
  it('Pluginとvariantを安全な画像URLへ正規化する', () => {
    expect(
      buildDiscordVisualAssetUrl({
        plugin: 'Team Split',
        variant: 'High Risk',
        baseUrl: 'https://herta.example///',
      }),
    ).toBe('https://herta.example/api/discord-assets/team-split/high-risk');
  });

  it('Embed fieldsをDiscord制約内へ制限する', () => {
    const fields = normalizeDiscordEmbedFields(
      Array.from({ length: 30 }, (_, index) => ({
        name: `${index}-${'n'.repeat(300)}`,
        value: 'v'.repeat(1200),
        inline: true,
      })),
    );

    expect(fields).toHaveLength(DISCORD_EMBED_LIMITS.fields);
    expect(fields?.every((field) => field.name.length <= DISCORD_EMBED_LIMITS.fieldName)).toBe(
      true,
    );
    expect(fields?.every((field) => field.value.length <= DISCORD_EMBED_LIMITS.fieldValue)).toBe(
      true,
    );
  });

  it('allowed mentionsは有効なSnowflakeだけを重複排除して許可する', () => {
    expect(
      safeDiscordMentions({
        roles: ['12345678901234567', '12345678901234567', '@everyone', '123'],
        users: ['123456789012345678', '123456789012345678', '<@1>'],
      }),
    ).toEqual({
      parse: [],
      roles: ['12345678901234567'],
      users: ['123456789012345678'],
    });
  });

  it('汎用Visual Embedへsemantic color・画像・footerを設定する', () => {
    const embed = buildDiscordVisualEmbed({
      title: '募集を作成しました',
      description: 'ゲーム参加者を募集します。',
      tone: 'success',
      plugin: 'lfg',
      variant: 'created',
      timestamp: '2026-08-07T12:00:00.000Z',
      fields: [{ name: '募集人数', value: '4人', inline: true }],
    });

    expect(embed.color).toBe(HERTA_DISCORD_COLORS.success);
    expect(embed.image?.url).toBe('https://herta.ivrm.jp/api/discord-assets/lfg/created');
    expect(embed.footer?.text).toBe('Herta • Lfg');
    expect(embed.timestamp).toBe('2026-08-07T12:00:00.000Z');
  });
});
