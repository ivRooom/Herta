import { NextResponse } from 'next/server';
import {
  deleteQuote,
  getQuoteByNumber,
  QuoteValidationError,
  updateQuote,
  type QuotePrismaClient,
  type UpdateQuoteInput,
} from '@herta/plugin-catalog/quote-service';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string; quoteNumber: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, quoteNumber: rawQuoteNumber } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const quoteNumber = parseQuoteNumber(rawQuoteNumber);
  if (!quoteNumber) return NextResponse.json({ error: 'Quote番号が不正です' }, { status: 400 });

  try {
    const quote = await getQuoteByNumber(
      prisma as unknown as QuotePrismaClient,
      guildId,
      quoteNumber,
    );
    if (!quote) return NextResponse.json({ error: 'Quoteが見つかりません' }, { status: 404 });
    return NextResponse.json(quote);
  } catch (error) {
    return quoteErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, quoteNumber: rawQuoteNumber } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const quoteNumber = parseQuoteNumber(rawQuoteNumber);
  if (!quoteNumber) return NextResponse.json({ error: 'Quote番号が不正です' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: '更新内容が不正です' }, { status: 400 });
  }

  const input: UpdateQuoteInput = {
    guildId,
    quoteNumber,
    actorId: session.user.id,
    operationSource: 'dashboard',
  };

  if ('quoteText' in body) {
    if (typeof body.quoteText !== 'string') return invalidField('quoteText');
    input.quoteText = body.quoteText;
  }
  if ('sourceAuthorName' in body) {
    if (body.sourceAuthorName !== null && typeof body.sourceAuthorName !== 'string') {
      return invalidField('sourceAuthorName');
    }
    input.sourceAuthorName = body.sourceAuthorName;
  }
  if ('tags' in body) {
    if (
      typeof body.tags !== 'string' &&
      !(Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === 'string'))
    ) {
      return invalidField('tags');
    }
    input.tags = body.tags;
  }
  if ('status' in body) {
    if (typeof body.status !== 'string') return invalidField('status');
    input.status = body.status;
  }
  if ('isNsfw' in body) {
    if (typeof body.isNsfw !== 'boolean') return invalidField('isNsfw');
    input.isNsfw = body.isNsfw;
  }

  try {
    const quote = await updateQuote(prisma as unknown as QuotePrismaClient, input);
    if (!quote) return NextResponse.json({ error: 'Quoteが見つかりません' }, { status: 404 });
    return NextResponse.json(quote);
  } catch (error) {
    return quoteErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId, quoteNumber: rawQuoteNumber } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const quoteNumber = parseQuoteNumber(rawQuoteNumber);
  if (!quoteNumber) return NextResponse.json({ error: 'Quote番号が不正です' }, { status: 400 });

  try {
    const deleted = await deleteQuote(prisma as unknown as QuotePrismaClient, {
      guildId,
      quoteNumber,
      actorId: session.user.id,
      operationSource: 'dashboard',
    });
    if (!deleted) return NextResponse.json({ error: 'Quoteが見つかりません' }, { status: 404 });
    return NextResponse.json({ deleted: true, quoteNumber });
  } catch (error) {
    return quoteErrorResponse(error);
  }
}

function parseQuoteNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function invalidField(field: string): NextResponse {
  return NextResponse.json({ error: `${field}が不正です` }, { status: 400 });
}

function quoteErrorResponse(error: unknown): NextResponse {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Quote API request failed', error);
  return NextResponse.json({ error: 'Quoteの処理に失敗しました' }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
