import {
  MAX_QUOTE_LENGTH,
  QuoteValidationError,
  normalizeOptionalText,
  parseQuoteTags,
  validateQuoteText,
} from './config.js';

export interface QuoteRecord {
  id: string;
  guildId: string;
  quoteNumber: number;
  quoteText: string;
  sourceMessageId: string | null;
  sourceChannelId: string | null;
  sourceMessageUrl: string | null;
  sourceAuthorId: string | null;
  sourceAuthorName: string | null;
  registeredById: string;
  registeredByName: string;
  tags: string[];
  status: string;
  isNsfw: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface QuoteDelegate {
  aggregate(args: Record<string, unknown>): Promise<{ _max: { quoteNumber: number | null } }>;
  count(args: Record<string, unknown>): Promise<number>;
  create(args: Record<string, unknown>): Promise<QuoteRecord>;
  delete(args: Record<string, unknown>): Promise<QuoteRecord>;
  findFirst(args: Record<string, unknown>): Promise<QuoteRecord | null>;
  findMany(args: Record<string, unknown>): Promise<QuoteRecord[]>;
  update(args: Record<string, unknown>): Promise<QuoteRecord>;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

export interface QuoteTransactionClient {
  quote: QuoteDelegate;
  auditLog: AuditLogDelegate;
}

export interface QuotePrismaClient extends QuoteTransactionClient {
  $transaction<T>(
    callback: (tx: QuoteTransactionClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

export type QuoteOperationSource = 'discord' | 'dashboard';

export interface CreateQuoteInput {
  guildId: string;
  quoteText: string;
  sourceAuthorName?: string | null;
  sourceAuthorId?: string | null;
  sourceMessageId?: string | null;
  sourceChannelId?: string | null;
  sourceMessageUrl?: string | null;
  registeredById: string;
  registeredByName: string;
  tags?: string[] | string;
  status?: string;
  isNsfw?: boolean;
  maxQuoteLength?: number;
  operationSource: QuoteOperationSource;
}

export interface ListQuotesInput {
  guildId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  tag?: string;
  status?: string;
  isNsfw?: boolean;
}

export interface ListQuotesResult {
  items: QuoteRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UpdateQuoteInput {
  guildId: string;
  quoteNumber: number;
  actorId: string;
  quoteText?: string;
  sourceAuthorName?: string | null;
  tags?: string[] | string;
  status?: string;
  isNsfw?: boolean;
  maxQuoteLength?: number;
  operationSource: QuoteOperationSource;
}

export interface DeleteQuoteInput {
  guildId: string;
  quoteNumber: number;
  actorId: string;
  operationSource: QuoteOperationSource;
}

const MAX_CREATE_RETRIES = 5;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const ALLOWED_STATUSES = new Set(['public', 'private', 'hidden']);

export async function createQuote(
  prisma: QuotePrismaClient,
  input: CreateQuoteInput,
): Promise<QuoteRecord> {
  assertGuildId(input.guildId);
  const quoteText = validateQuoteText(input.quoteText, input.maxQuoteLength ?? MAX_QUOTE_LENGTH);
  const sourceAuthorName = normalizeOptionalText(input.sourceAuthorName, 100, '作者名');
  const tags = parseQuoteTags(input.tags);
  const status = normalizeStatus(input.status);
  const registeredByName = normalizeOptionalText(input.registeredByName, 100, '登録者名');
  if (!registeredByName) throw new QuoteValidationError('登録者名を入力してください');

  for (let attempt = 1; attempt <= MAX_CREATE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const aggregate = await tx.quote.aggregate({
            where: { guildId: input.guildId },
            _max: { quoteNumber: true },
          });
          const quoteNumber = (aggregate._max.quoteNumber ?? 0) + 1;
          const created = await tx.quote.create({
            data: {
              guildId: input.guildId,
              quoteNumber,
              quoteText,
              sourceMessageId: input.sourceMessageId ?? null,
              sourceChannelId: input.sourceChannelId ?? null,
              sourceMessageUrl: input.sourceMessageUrl ?? null,
              sourceAuthorId: input.sourceAuthorId ?? null,
              sourceAuthorName,
              registeredById: input.registeredById,
              registeredByName,
              tags,
              status,
              isNsfw: input.isNsfw ?? false,
            },
          });
          await tx.auditLog.create({
            data: {
              guildId: input.guildId,
              actorId: input.registeredById,
              event: 'quote.create',
              targetType: 'quote',
              targetId: created.id,
              changes: { after: toAuditQuote(created) },
              metadata: { quoteNumber, operationSource: input.operationSource },
            },
          });
          return created;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (attempt < MAX_CREATE_RETRIES && isRetryableCreateError(error)) continue;
      throw error;
    }
  }

  throw new Error('Quote番号の採番に失敗しました');
}

export async function getQuoteByNumber(
  prisma: QuotePrismaClient,
  guildId: string,
  quoteNumber: number,
): Promise<QuoteRecord | null> {
  assertGuildId(guildId);
  assertQuoteNumber(quoteNumber);
  return prisma.quote.findFirst({ where: { guildId, quoteNumber } });
}

export async function getRandomQuote(
  prisma: QuotePrismaClient,
  guildId: string,
  options: { tag?: string; random?: () => number } = {},
): Promise<QuoteRecord | null> {
  assertGuildId(guildId);
  const where = buildWhere({ guildId, status: 'public', tag: options.tag });
  const count = await prisma.quote.count({ where });
  if (count === 0) return null;
  const random = options.random ?? Math.random;
  const skip = Math.min(Math.floor(random() * count), count - 1);
  return prisma.quote.findFirst({ where, orderBy: { quoteNumber: 'asc' }, skip });
}

export async function listQuotes(
  prisma: QuotePrismaClient,
  input: ListQuotesInput,
): Promise<ListQuotesResult> {
  assertGuildId(input.guildId);
  const page = clampPositiveInteger(input.page, 1);
  const pageSize = Math.min(clampPositiveInteger(input.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const where = buildWhere(input);
  const [items, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: { quoteNumber: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.quote.count({ where }),
  ]);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateQuote(
  prisma: QuotePrismaClient,
  input: UpdateQuoteInput,
): Promise<QuoteRecord | null> {
  assertGuildId(input.guildId);
  assertQuoteNumber(input.quoteNumber);
  return prisma.$transaction(async (tx) => {
    const current = await tx.quote.findFirst({
      where: { guildId: input.guildId, quoteNumber: input.quoteNumber },
    });
    if (!current) return null;

    const data: Record<string, unknown> = {};
    if (input.quoteText !== undefined) {
      data.quoteText = validateQuoteText(
        input.quoteText,
        input.maxQuoteLength ?? MAX_QUOTE_LENGTH,
      );
    }
    if (input.sourceAuthorName !== undefined) {
      data.sourceAuthorName = normalizeOptionalText(input.sourceAuthorName, 100, '作者名');
    }
    if (input.tags !== undefined) data.tags = parseQuoteTags(input.tags);
    if (input.status !== undefined) data.status = normalizeStatus(input.status);
    if (input.isNsfw !== undefined) data.isNsfw = input.isNsfw;
    if (Object.keys(data).length === 0) return current;

    const updated = await tx.quote.update({ where: { id: current.id }, data });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'quote.update',
        targetType: 'quote',
        targetId: current.id,
        changes: { before: toAuditQuote(current), after: toAuditQuote(updated) },
        metadata: { quoteNumber: current.quoteNumber, operationSource: input.operationSource },
      },
    });
    return updated;
  });
}

export async function deleteQuote(
  prisma: QuotePrismaClient,
  input: DeleteQuoteInput,
): Promise<QuoteRecord | null> {
  assertGuildId(input.guildId);
  assertQuoteNumber(input.quoteNumber);
  return prisma.$transaction(async (tx) => {
    const current = await tx.quote.findFirst({
      where: { guildId: input.guildId, quoteNumber: input.quoteNumber },
    });
    if (!current) return null;
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'quote.delete',
        targetType: 'quote',
        targetId: current.id,
        changes: { before: toAuditQuote(current) },
        metadata: { quoteNumber: current.quoteNumber, operationSource: input.operationSource },
      },
    });
    await tx.quote.delete({ where: { id: current.id } });
    return current;
  });
}

function buildWhere(input: {
  guildId: string;
  search?: string;
  tag?: string;
  status?: string;
  isNsfw?: boolean;
}): Record<string, unknown> {
  const where: Record<string, unknown> = { guildId: input.guildId };
  if (input.status) where.status = normalizeStatus(input.status);
  if (typeof input.isNsfw === 'boolean') where.isNsfw = input.isNsfw;
  const tag = input.tag?.trim().toLowerCase();
  if (tag) where.tags = { has: tag };
  const search = input.search?.trim();
  if (search) {
    const numeric = Number(search);
    where.OR = [
      { quoteText: { contains: search, mode: 'insensitive' } },
      { sourceAuthorName: { contains: search, mode: 'insensitive' } },
      ...(Number.isSafeInteger(numeric) && numeric > 0 ? [{ quoteNumber: numeric }] : []),
    ];
  }
  return where;
}

function normalizeStatus(value: unknown): string {
  const status = typeof value === 'string' && value.trim() ? value.trim() : 'public';
  if (!ALLOWED_STATUSES.has(status)) {
    throw new QuoteValidationError('ステータスはpublic、private、hiddenのいずれかです');
  }
  return status;
}

function assertGuildId(guildId: string): void {
  if (!/^\d+$/.test(guildId)) throw new QuoteValidationError('Guild IDが不正です');
}

function assertQuoteNumber(quoteNumber: number): void {
  if (!Number.isSafeInteger(quoteNumber) || quoteNumber < 1) {
    throw new QuoteValidationError('Quote番号は1以上の整数で指定してください');
  }
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function isRetryableCreateError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'P2002' || code === 'P2034';
}

function toAuditQuote(quote: QuoteRecord): Record<string, unknown> {
  return {
    quoteNumber: quote.quoteNumber,
    quoteText: quote.quoteText,
    sourceAuthorName: quote.sourceAuthorName,
    tags: quote.tags,
    status: quote.status,
    isNsfw: quote.isNsfw,
  };
}
