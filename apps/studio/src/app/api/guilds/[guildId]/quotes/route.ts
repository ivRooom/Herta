import { NextResponse } from 'next/server';
import {
  createQuote,
  listQuotes,
  QuoteValidationError,
  type QuotePrismaClient,
} from '@herta/plugin-catalog/quote-service';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  try {
    const result = await listQuotes(prisma as unknown as QuotePrismaClient, {
      guildId,
      page: parsePositiveInteger(url.searchParams.get('page')),
      pageSize: parsePositiveInteger(url.searchParams.get('pageSize')),
      search: url.searchParams.get('search') ?? undefined,
      tag: url.searchParams.get('tag') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      isNsfw: parseOptionalBoolean(url.searchParams.get('isNsfw')),
    });
    return NextResponse.json(result);
  } catch (error) {
    return quoteErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.quoteText !== 'string') {
    return NextResponse.json({ error: '名言本文を入力してください' }, { status: 400 });
  }

  try {
    const quote = await createQuote(prisma as unknown as QuotePrismaClient, {
      guildId,
      quoteText: body.quoteText,
      sourceAuthorName: optionalString(body.sourceAuthorName),
      registeredById: session.user.id,
      registeredByName: session.user.name?.trim() || session.user.email?.trim() || session.user.id,
      tags: parseTags(body.tags),
      status: optionalString(body.status) ?? undefined,
      isNsfw: typeof body.isNsfw === 'boolean' ? body.isNsfw : false,
      operationSource: 'dashboard',
    });
    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    return quoteErrorResponse(error);
  }
}

function quoteErrorResponse(error: unknown): NextResponse {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Quote API request failed', error);
  return NextResponse.json({ error: 'Quoteの処理に失敗しました' }, { status: 500 });
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseTags(value: unknown): string[] | string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((tag) => typeof tag === 'string')) return value;
  return undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
