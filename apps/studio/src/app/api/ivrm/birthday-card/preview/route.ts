import {
  BIRTHDAY_CARD_PREVIEW_SAMPLE,
  createBirthdayCardSampleAvatar,
  fetchBirthdayCardBackgroundImage,
  renderBirthdayCard,
} from '@herta/birthday-card';
import { getBirthdayCardRuntimeBackground } from '@herta/db';
import {
  authorizeBirthdayCardPreview,
  buildBirthdayCardPreviewConfig,
  type BirthdayCardPreviewCardInput,
} from '@/lib/birthday-card-preview-api';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BIRTHDAY_ROLE_PLUGIN_ID = 'birthday-role';

function isPluginConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renders one preview PNG for the fixed sample subject. The
 * background chain mirrors the bot's delivery path: the
 * Admin-supplied backgroundUrl wins when it downloads and
 * validates, then the Studio-stored background (custom /
 * asset), then the bundled preset inside the renderer. No
 * delivery rows are written; a preview has no side effects.
 */
async function renderPreview(
  guildId: string,
  rawPluginConfig: unknown,
  card: BirthdayCardPreviewCardInput,
): Promise<Buffer> {
  const config = buildBirthdayCardPreviewConfig(rawPluginConfig, card);
  const remoteBackground = card.backgroundUrl
    ? await fetchBirthdayCardBackgroundImage(card.backgroundUrl)
    : null;
  let customBackground: Buffer | null = null;
  if (
    !remoteBackground &&
    (config.birthdayCardBackgroundSource === 'custom' ||
      config.birthdayCardBackgroundSource === 'asset')
  ) {
    const stored = await getBirthdayCardRuntimeBackground(prisma, guildId, config);
    customBackground = stored?.content ?? null;
  }
  return renderBirthdayCard({
    config,
    displayName: BIRTHDAY_CARD_PREVIEW_SAMPLE.displayName,
    avatarUrl: null,
    avatarBytes: config.birthdayCardShowAvatar ? await createBirthdayCardSampleAvatar() : null,
    month: BIRTHDAY_CARD_PREVIEW_SAMPLE.month,
    day: BIRTHDAY_CARD_PREVIEW_SAMPLE.day,
    // The fixed sample age is drawn only when the request
    // turns showAge on; otherwise the preview stays age-free
    // exactly like a delivery with showAge off.
    age: config.birthdayCardShowAge ? BIRTHDAY_CARD_PREVIEW_SAMPLE.age : null,
    customBackground,
    remoteBackground,
  });
}

export async function POST(request: Request) {
  const input = await authorizeBirthdayCardPreview(request);
  if (input instanceof Response) return input;
  try {
    const row = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId: input.guildId, pluginId: BIRTHDAY_ROLE_PLUGIN_ID } },
    });
    const png = await renderPreview(
      input.guildId,
      isPluginConfig(row?.config) ? row.config : {},
      input.card,
    );
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return Response.json(
      { error: 'birthday_card_preview_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
