import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import type { Logger } from '@herta/logger';
import { setVoiceTranscriptionConsent, type PrismaClient } from '@herta/db';
import { revokeVcRecapConsent } from './vc-recap-session-manager.js';

export const CONSENT_CUSTOM_ID_PREFIX = 'herta:consent:v1:';

export interface ConsentCustomId {
  action: 'yes' | 'no';
  userId: string;
}

/**
 * customIdは`herta:consent:v1:<yes|no>:<userId>`。永続的なボタン(メッセージが長期間
 * 放置される前提)のため、session/collectorに依存せずcustomIdだけで状態を復元できる形にする。
 */
export function parseConsentCustomId(customId: string): ConsentCustomId | null {
  if (!customId.startsWith(CONSENT_CUSTOM_ID_PREFIX)) return null;
  const rest = customId.slice(CONSENT_CUSTOM_ID_PREFIX.length);
  const [action, userId] = rest.split(':');
  if (action !== 'yes' && action !== 'no') return null;
  if (!userId || !/^\d{17,20}$/.test(userId)) return null;
  return { action, userId };
}

export function buildConsentActionRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONSENT_CUSTOM_ID_PREFIX}yes:${userId}`)
      .setLabel('同意する')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CONSENT_CUSTOM_ID_PREFIX}no:${userId}`)
      .setLabel('同意しない')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildConsentPromptContent(userId: string): string {
  return (
    `<@${userId}> さんはまだVC発言の文字起こしに同意していません。\n` +
    '同意すると、今後のVC Recapで発言が要約の対象になります(いつでも`/herta-privacy voice-consent`で取り消せます)。'
  );
}

export async function handleConsentButton(
  interaction: ButtonInteraction,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  const parsed = parseConsentCustomId(interaction.customId);
  if (!parsed) return;

  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({
      content: 'この操作は本人のみ実行できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const consent = parsed.action === 'yes';
  try {
    await setVoiceTranscriptionConsent(prisma, parsed.userId, consent);
    if (!consent) revokeVcRecapConsent(parsed.userId);
  } catch (error) {
    logger.warn({ err: error, userId: parsed.userId }, 'VC Recap同意ボタンの処理に失敗しました');
    await interaction.reply({
      content: '処理に失敗しました。`/herta-privacy voice-consent`から再度お試しください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    content: consent
      ? '✅ 同意しました。ありがとうございます。'
      : '🔒 同意しませんでした。今後も発言は録音・文字起こしされません。',
    components: [],
  });
}
