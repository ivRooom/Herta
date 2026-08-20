import type { StaticImageData } from 'next/image';
import { NextResponse } from 'next/server';
import hertaLavenderGifts from '../../../../../public/birthday-card-presets/herta-lavender-gifts.webp';
import hertaLavenderTea from '../../../../../public/birthday-card-presets/herta-lavender-tea.webp';
import hertaNightBoard from '../../../../../public/birthday-card-presets/herta-night-board.webp';

export const dynamic = 'force-dynamic';

const PRESET_ASSETS: Readonly<Record<string, StaticImageData>> = {
  'herta-lavender-gifts.webp': hertaLavenderGifts,
  'herta-lavender-tea.webp': hertaLavenderTea,
  'herta-night-board.webp': hertaNightBoard,
};

export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const preset = PRESET_ASSETS[asset];
  if (!preset) {
    return NextResponse.json(
      { error: 'Birthday Card presetが見つかりません' },
      {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }

  const response = NextResponse.redirect(new URL(preset.src, request.url), 307);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
