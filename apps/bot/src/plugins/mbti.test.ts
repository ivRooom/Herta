import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { MBTI_TYPE_KEYS, mbtiManifest, mbtiRoleConfigKey } from '@herta/plugin-catalog';
import { createMbtiResultCommandHandler, normalizeMbtiConfig } from './mbti.js';

function emptyMbtiRoles(): Record<string, string | null> {
  return Object.fromEntries(MBTI_TYPE_KEYS.map((type) => [type, null]));
}

describe('MBTI Plugin', () => {
  it('設定を安全な範囲へ正規化する', () => {
    expect(normalizeMbtiConfig(undefined)).toEqual({
      enabled: true,
      mbtiRoles: emptyMbtiRoles(),
    });
    expect(normalizeMbtiConfig({ enabled: false })).toEqual({
      enabled: false,
      mbtiRoles: emptyMbtiRoles(),
    });
  });

  it('MBTI Role IDを正規化し不正な値はnullへフォールバックする', () => {
    const normalized = normalizeMbtiConfig({
      [mbtiRoleConfigKey('INTJ')]: '123456789012345678',
      [mbtiRoleConfigKey('ENFP')]: 'not-a-discord-id',
    });
    expect(normalized.mbtiRoles.INTJ).toBe('123456789012345678');
    expect(normalized.mbtiRoles.ENFP).toBeNull();
    expect(normalized.mbtiRoles.ISTJ).toBeNull();
    expect(Object.keys(normalized.mbtiRoles).sort()).toEqual([...MBTI_TYPE_KEYS].sort());
  });

  it('Manifestに診断と本人向け結果コマンドを登録する', () => {
    expect(mbtiManifest.commands.map((command) => command.name)).toEqual(['mbti', 'mbti-result']);
  });
});

describe('/mbti-result', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('issues only a private URL for the invoking guild and user', async () => {
    vi.stubEnv('STUDIO_PUBLIC_BASE_URL', 'https://herta.example');
    const findFirst = vi.fn().mockResolvedValue({ resultType: 'INFP', resultIdentity: 'T' });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      mbtiPersonalResult: { findFirst },
      mbtiResultAccess: { upsert },
    } as unknown as PrismaClient;
    const interaction = {
      guildId: '123456789012345678',
      user: { id: '223456789012345678' },
      options: { getString: () => 'history' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
    await createMbtiResultCommandHandler(mbtiManifest.commands[1]!, prisma).execute(
      interaction as unknown as ChatInputCommandInteraction,
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(findFirst.mock.calls[0]![0].where).toEqual({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    });
    const body = interaction.editReply.mock.calls[0]![0].content as string;
    expect(body).toMatch(/https:\/\/herta.example\/mbti\/history\/[A-Za-z0-9_-]{43}#history/);
    const token = body.match(/history\/([A-Za-z0-9_-]{43})/)![1];
    expect(JSON.stringify(upsert.mock.calls)).not.toContain(token);
    expect(body).not.toContain(interaction.user.id);
    expect(body).toContain('<https://herta.example/mbti/history/');
  });
  it('allows loopback HTTP only in development and rejects remote HTTP', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { mbtiPersonalResult: { findFirst } } as unknown as PrismaClient;
    const interaction = {
      guildId: 'guild',
      user: { id: 'user' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STUDIO_PUBLIC_BASE_URL', 'http://localhost:3000');
    await createMbtiResultCommandHandler(mbtiManifest.commands[1]!, prisma).execute(
      interaction as unknown as ChatInputCommandInteraction,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
    vi.stubEnv('STUDIO_PUBLIC_BASE_URL', 'http://herta.example');
    await createMbtiResultCommandHandler(mbtiManifest.commands[1]!, prisma).execute(
      interaction as unknown as ChatInputCommandInteraction,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
    vi.stubEnv('STUDIO_PUBLIC_BASE_URL', 'http://localhost:3000');
    vi.stubEnv('NODE_ENV', 'production');
    await createMbtiResultCommandHandler(mbtiManifest.commands[1]!, prisma).execute(
      interaction as unknown as ChatInputCommandInteraction,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
  it('does not issue an access token when no history exists', async () => {
    vi.stubEnv('STUDIO_PUBLIC_BASE_URL', 'https://herta.example');
    const upsert = vi.fn();
    const prisma = {
      mbtiPersonalResult: { findFirst: vi.fn().mockResolvedValue(null) },
      mbtiResultAccess: { upsert },
    } as unknown as PrismaClient;
    const interaction = {
      guildId: 'guild',
      user: { id: 'user' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
    await createMbtiResultCommandHandler(mbtiManifest.commands[1]!, prisma).execute(
      interaction as unknown as ChatInputCommandInteraction,
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0]![0]).toContain('保存された診断結果はまだありません');
  });
});
