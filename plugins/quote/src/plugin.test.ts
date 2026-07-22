import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import { DEFAULT_QUOTE_CONFIG, type QuoteConfig } from './config.js';
import { quoteManifest } from './manifest.js';
import { quotePlugin } from './plugin.js';
import type { QuotePrismaClient, QuoteRecord, QuoteTransactionClient } from './service.js';

interface TestInteraction {
  guildId: string | null;
  channelId: string | null;
  user: { id: string; username: string; globalName: string | null };
  memberPermissions: { has(permission: bigint): boolean } | null;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  replied: boolean;
  deferred: boolean;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
}

function createPrisma(): { prisma: QuotePrismaClient; records: QuoteRecord[]; audits: string[] } {
  const records: QuoteRecord[] = [];
  const audits: string[] = [];
  const quote = {
    aggregate: vi.fn(async () => ({
      _max: {
        quoteNumber: records.length
          ? Math.max(...records.map((record) => record.quoteNumber))
          : null,
      },
    })),
    count: vi.fn(async () => records.length),
    create: vi.fn(async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>;
      const now = new Date();
      const record: QuoteRecord = {
        id: `quote-${records.length + 1}`,
        guildId: String(data.guildId),
        quoteNumber: Number(data.quoteNumber),
        quoteText: String(data.quoteText),
        sourceMessageId: null,
        sourceChannelId: null,
        sourceMessageUrl: null,
        sourceAuthorId: null,
        sourceAuthorName:
          data.sourceAuthorName === null || data.sourceAuthorName === undefined
            ? null
            : String(data.sourceAuthorName),
        registeredById: String(data.registeredById),
        registeredByName: String(data.registeredByName),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        status: String(data.status),
        isNsfw: Boolean(data.isNsfw),
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return record;
    }),
    delete: vi.fn(async () => records[0]!),
    findFirst: vi.fn(async () => records[0] ?? null),
    findMany: vi.fn(async () => records),
    update: vi.fn(async () => records[0]!),
  };
  const auditLog = {
    create: vi.fn(async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>;
      audits.push(String(data.event));
      return data;
    }),
  };
  const tx: QuoteTransactionClient = { quote, auditLog };
  const prisma: QuotePrismaClient = {
    ...tx,
    $transaction: async <T>(callback: (client: QuoteTransactionClient) => Promise<T>) => callback(tx),
  };
  return { prisma, records, audits };
}

function createContext(
  prisma: QuotePrismaClient,
  config: QuoteConfig = DEFAULT_QUOTE_CONFIG,
): PluginRuntimeContext<QuoteConfig, unknown, QuotePrismaClient> {
  return {
    client: {},
    prisma,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger,
    guildId: '100',
    config,
    manifest: quoteManifest,
  };
}

function createInteraction(
  subcommand: string,
  values: Record<string, string | number> = {},
  canManage = false,
): TestInteraction {
  return {
    guildId: '100',
    channelId: '200',
    user: { id: '300', username: 'tester', globalName: 'Tester' },
    memberPermissions: {
      has: () => canManage,
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => (typeof values[name] === 'string' ? String(values[name]) : null),
      getInteger: (name) => (typeof values[name] === 'number' ? Number(values[name]) : null),
    },
    replied: false,
    deferred: false,
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

async function execute(
  context: PluginRuntimeContext<QuoteConfig, unknown, QuotePrismaClient>,
  interaction: TestInteraction,
): Promise<void> {
  const command = quotePlugin.provideCommands?.(context)[0];
  if (!command) throw new Error('Quote command is not available');
  await command.execute(interaction as never);
}

describe('Quote Plugin command', () => {
  it('必要なサブコマンドをすべて公開する', () => {
    expect(quoteManifest.commands[0]?.subcommands?.map((command) => command.name)).toEqual([
      'random',
      'show',
      'add',
      'delete',
      'list',
    ]);
  });

  it('一般メンバー登録が無効な場合はaddを拒否する', async () => {
    const { prisma, records } = createPrisma();
    const context = createContext(prisma, {
      ...DEFAULT_QUOTE_CONFIG,
      allowMemberRegistration: false,
    });
    const interaction = createInteraction('add', { text: '登録できない名言' });

    await execute(context, interaction);

    expect(records).toHaveLength(0);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '名言を登録する権限がありません', flags: 64 }),
    );
  });

  it('管理権限を持つユーザーは設定に関係なくaddできる', async () => {
    const { prisma, records, audits } = createPrisma();
    const context = createContext(prisma, {
      ...DEFAULT_QUOTE_CONFIG,
      allowMemberRegistration: false,
    });
    const interaction = createInteraction(
      'add',
      { text: 'テスト名言', author: 'Herta', tags: 'test, bot' },
      true,
    );

    await execute(context, interaction);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      guildId: '100',
      quoteNumber: 1,
      quoteText: 'テスト名言',
      sourceAuthorName: 'Herta',
      tags: ['test', 'bot'],
    });
    expect(audits).toEqual(['quote.create']);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Quote #1 を登録しました') }),
    );
  });

  it('許可されていないチャンネルではServiceを実行しない', async () => {
    const { prisma, records } = createPrisma();
    const context = createContext(prisma, {
      ...DEFAULT_QUOTE_CONFIG,
      allowedChannelIds: ['999'],
    });
    const interaction = createInteraction('add', { text: '登録されない名言' }, true);

    await execute(context, interaction);

    expect(records).toHaveLength(0);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'このチャンネルではQuote Pluginを利用できません' }),
    );
  });
});
