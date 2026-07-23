import { describe, expect, it } from 'vitest';
import {
  createQuote,
  deleteQuote,
  getQuoteByNumber,
  getRandomQuote,
  listQuotes,
  updateQuote,
  type QuotePrismaClient,
  type QuoteRecord,
} from './service.js';

interface MemoryPrisma {
  client: QuotePrismaClient;
  records: QuoteRecord[];
  auditEvents: string[];
}

function createMemoryPrisma(options: { failTransactions?: number } = {}): MemoryPrisma {
  const records: QuoteRecord[] = [];
  const auditEvents: string[] = [];
  let idSequence = 0;
  let failTransactions = options.failTransactions ?? 0;

  const quote = {
    async aggregate(args: Record<string, unknown>) {
      const matches = filterRecords(records, readWhere(args));
      return {
        _max: {
          quoteNumber: matches.length
            ? Math.max(...matches.map((record) => record.quoteNumber))
            : null,
        },
      };
    },
    async count(args: Record<string, unknown>) {
      return filterRecords(records, readWhere(args)).length;
    },
    async create(args: Record<string, unknown>) {
      const data = readRecord(args, 'data');
      const guildId = String(data.guildId);
      const quoteNumber = Number(data.quoteNumber);
      if (
        records.some((record) => record.guildId === guildId && record.quoteNumber === quoteNumber)
      ) {
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }
      const now = new Date();
      const record: QuoteRecord = {
        id: `quote-${++idSequence}`,
        guildId,
        quoteNumber,
        quoteText: String(data.quoteText),
        sourceMessageId: nullableString(data.sourceMessageId),
        sourceChannelId: nullableString(data.sourceChannelId),
        sourceMessageUrl: nullableString(data.sourceMessageUrl),
        sourceAuthorId: nullableString(data.sourceAuthorId),
        sourceAuthorName: nullableString(data.sourceAuthorName),
        registeredById: String(data.registeredById),
        registeredByName: String(data.registeredByName),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        status: String(data.status ?? 'public'),
        isNsfw: Boolean(data.isNsfw),
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return record;
    },
    async delete(args: Record<string, unknown>) {
      const where = readRecord(args, 'where');
      const index = records.findIndex((record) => record.id === where.id);
      if (index < 0) throw new Error('not found');
      return records.splice(index, 1)[0]!;
    },
    async findFirst(args: Record<string, unknown>) {
      const matches = sortRecords(filterRecords(records, readWhere(args)), args.orderBy);
      const skip = typeof args.skip === 'number' ? args.skip : 0;
      return matches[skip] ?? null;
    },
    async findMany(args: Record<string, unknown>) {
      const matches = sortRecords(filterRecords(records, readWhere(args)), args.orderBy);
      const skip = typeof args.skip === 'number' ? args.skip : 0;
      const take = typeof args.take === 'number' ? args.take : matches.length;
      return matches.slice(skip, skip + take);
    },
    async update(args: Record<string, unknown>) {
      const where = readRecord(args, 'where');
      const data = readRecord(args, 'data');
      const record = records.find((candidate) => candidate.id === where.id);
      if (!record) throw new Error('not found');
      Object.assign(record, data, { updatedAt: new Date() });
      return record;
    },
  };

  const transactionClient = {
    quote,
    auditLog: {
      async create(args: Record<string, unknown>) {
        const data = readRecord(args, 'data');
        auditEvents.push(String(data.event));
        return data;
      },
    },
  };

  const client = {
    ...transactionClient,
    async $transaction<T>(callback: (tx: typeof transactionClient) => Promise<T>): Promise<T> {
      if (failTransactions > 0) {
        failTransactions -= 1;
        throw Object.assign(new Error('serialization failure'), { code: 'P2034' });
      }
      return callback(transactionClient);
    },
  } as unknown as QuotePrismaClient;

  return { client, records, auditEvents };
}

describe('Quote service', () => {
  it('Guildごとに連番とデータを分離する', async () => {
    const memory = createMemoryPrisma();
    const first = await create(memory.client, '100', '最初の名言');
    const second = await create(memory.client, '100', '次の名言');
    const otherGuild = await create(memory.client, '200', '別Guildの名言');

    expect([first.quoteNumber, second.quoteNumber, otherGuild.quoteNumber]).toEqual([1, 2, 1]);

    const guildA = await listQuotes(memory.client, { guildId: '100' });
    const guildB = await listQuotes(memory.client, { guildId: '200' });
    expect(guildA.items.map((quote) => quote.quoteText)).toEqual(['次の名言', '最初の名言']);
    expect(guildB.items.map((quote) => quote.quoteText)).toEqual(['別Guildの名言']);
    expect(memory.auditEvents).toEqual(['quote.create', 'quote.create', 'quote.create']);
  });

  it('他GuildのQuoteを参照・更新・削除できない', async () => {
    const memory = createMemoryPrisma();
    await create(memory.client, '100', '保護対象');

    expect(await getQuoteByNumber(memory.client, '200', 1)).toBeNull();
    expect(
      await updateQuote(memory.client, {
        guildId: '200',
        quoteNumber: 1,
        quoteText: '改ざん',
        actorId: 'user-2',
        operationSource: 'dashboard',
      }),
    ).toBeNull();
    expect(
      await deleteQuote(memory.client, {
        guildId: '200',
        quoteNumber: 1,
        actorId: 'user-2',
        operationSource: 'dashboard',
      }),
    ).toBeNull();

    expect(memory.records).toHaveLength(1);
    expect(memory.records[0]?.quoteText).toBe('保護対象');
  });

  it('採番競合に相当するSerializableエラーを再試行する', async () => {
    const memory = createMemoryPrisma({ failTransactions: 1 });
    const quote = await create(memory.client, '100', '再試行後に登録');
    expect(quote.quoteNumber).toBe(1);
    expect(memory.records).toHaveLength(1);
  });

  it('タグ指定のランダム取得をGuild内へ限定する', async () => {
    const memory = createMemoryPrisma();
    await create(memory.client, '100', '対象外', ['other']);
    await create(memory.client, '100', '対象', ['herta']);
    await create(memory.client, '200', '別Guild', ['herta']);

    const quote = await getRandomQuote(memory.client, '100', { tag: 'herta', random: () => 0 });
    expect(quote?.quoteText).toBe('対象');
  });
});

async function create(
  prisma: QuotePrismaClient,
  guildId: string,
  quoteText: string,
  tags: string[] = [],
): Promise<QuoteRecord> {
  return createQuote(prisma, {
    guildId,
    quoteText,
    registeredById: 'user-1',
    registeredByName: 'Tester',
    tags,
    operationSource: 'discord',
  });
}

function readWhere(args: Record<string, unknown>): Record<string, unknown> {
  return isRecord(args.where) ? args.where : {};
}

function readRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (!isRecord(value)) throw new Error(`${key} is required`);
  return value;
}

function filterRecords(records: QuoteRecord[], where: Record<string, unknown>): QuoteRecord[] {
  return records.filter((record) => matchesWhere(record, where));
}

function matchesWhere(record: QuoteRecord, where: Record<string, unknown>): boolean {
  if (where.guildId !== undefined && record.guildId !== where.guildId) return false;
  if (where.quoteNumber !== undefined && record.quoteNumber !== where.quoteNumber) return false;
  if (where.status !== undefined && record.status !== where.status) return false;
  if (where.isNsfw !== undefined && record.isNsfw !== where.isNsfw) return false;

  if (isRecord(where.tags) && typeof where.tags.has === 'string') {
    if (!record.tags.includes(where.tags.has)) return false;
  }

  if (Array.isArray(where.OR)) {
    const matched = where.OR.some(
      (condition) => isRecord(condition) && matchesOr(record, condition),
    );
    if (!matched) return false;
  }
  return true;
}

function matchesOr(record: QuoteRecord, condition: Record<string, unknown>): boolean {
  if (condition.quoteNumber !== undefined) return record.quoteNumber === condition.quoteNumber;
  if (isRecord(condition.quoteText) && typeof condition.quoteText.contains === 'string') {
    return record.quoteText.toLowerCase().includes(condition.quoteText.contains.toLowerCase());
  }
  if (
    isRecord(condition.sourceAuthorName) &&
    typeof condition.sourceAuthorName.contains === 'string'
  ) {
    return Boolean(
      record.sourceAuthorName
        ?.toLowerCase()
        .includes(condition.sourceAuthorName.contains.toLowerCase()),
    );
  }
  return false;
}

function sortRecords(records: QuoteRecord[], orderBy: unknown): QuoteRecord[] {
  if (!isRecord(orderBy) || orderBy.quoteNumber === undefined) return [...records];
  const direction = orderBy.quoteNumber === 'desc' ? -1 : 1;
  return [...records].sort((left, right) => (left.quoteNumber - right.quoteNumber) * direction);
}

function nullableString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
