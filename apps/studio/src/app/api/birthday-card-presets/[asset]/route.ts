import { NextResponse } from 'next/server';
import { readBirthdayCardPresetAsset } from '@/lib/birthday-card-preset-assets';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const preset = await readBirthdayCardPresetAsset(asset);
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

  return new Response(new Uint8Array(preset.bytes), {
    status: 200,
    headers: {
      'Content-Type': preset.contentType,
      'Content-Length': String(preset.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
