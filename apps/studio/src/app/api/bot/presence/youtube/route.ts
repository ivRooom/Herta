import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  isYouTubeConfigured,
  searchYouTubeVideos,
  YouTubeCatalogError,
} from '@/lib/youtube-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Herta管理者権限が必要です' }, { status: 403 });
  }

  if (!isYouTubeConfigured()) {
    return NextResponse.json({ configured: false, videos: [] });
  }

  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    const videos = await searchYouTubeVideos(query);
    return NextResponse.json({ configured: true, videos });
  } catch (error) {
    if (error instanceof YouTubeCatalogError) {
      const status =
        error.code === 'invalid_query'
          ? 400
          : error.code === 'rate_limited'
            ? 429
            : error.code === 'not_configured'
              ? 503
              : 502;
      return NextResponse.json({ configured: true, error: error.message }, { status });
    }

    console.error('YouTube Presence検索に失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { configured: true, error: 'YouTube検索に失敗しました' },
      { status: 502 },
    );
  }
}
