import { BIRTHDAY_CARD_PRESETS } from '@herta/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PRESET_ASSETS = new Set(BIRTHDAY_CARD_PRESETS.map((preset) => preset.assetFile));
const PRESET_ROOT_CANDIDATES = [
  path.join(process.cwd(), 'public', 'birthday-card-presets'),
  path.join(process.cwd(), 'apps', 'studio', 'public', 'birthday-card-presets'),
];

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (!PRESET_ASSETS.has(asset as (typeof BIRTHDAY_CARD_PRESETS)[number]['assetFile'])) {
    return presetError('Birthday Card presetが見つかりません', 404);
  }

  for (const root of PRESET_ROOT_CANDIDATES) {
    try {
      const content = await readFile(path.join(root, asset));
      return new Response(new Uint8Array(content), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(content.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (isMissingFileError(error)) continue;
      console.error('Birthday Card preset read failed', {
        asset,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return presetError('Birthday Card presetを読み込めませんでした', 500);
    }
  }

  console.error('Birthday Card preset missing from Studio runtime', { asset });
  return presetError('Birthday Card presetを読み込めませんでした', 503);
}

function presetError(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
