import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import type { Logger } from '@herta/logger';
import {
  issueVoiceConsentAccess,
  setVoiceTranscriptionConsent,
  type PrismaClient,
} from '@herta/db';
import { resolveStudioPublicBaseUrl } from '../studio-base-url.js';
import { revokeVcRecapConsent } from './vc-recap-session-manager.js';

/** 同意ボタンのinteractionを振り分けるためのプレフィックス(全バージョン共通)。 */
export const CONSENT_CUSTOM_ID_PREFIX = 'herta:consent:';
/**
 * v1: 本文は要約後に削除する説明だった頃のボタン。v2: 本文の30日保存を説明したボタン。
 * 古いメッセージのv1ボタンで同意しても、本人が見ていない本文保存には同意したことにしない。
 */
const CONSENT_CUSTOM_ID_VERSIONS = { v1: false, v2: true } as const;
const CURRENT_CONSENT_CUSTOM_ID_PREFIX = `${CONSENT_CUSTOM_ID_PREFIX}v2:`;

export interface ConsentCustomId {
  action: 'yes' | 'no' | 'web';
  userId: string;
  /** ボタンのメッセージが文字起こし本文の30日保存を説明していたか。 */
  transcriptRetention: boolean;
}

/**
 * customIdは`herta:consent:<v1|v2>:<yes|no|web>:<userId>`。永続的なボタン(メッセージが長期間
 * 放置される前提)のため、session/collectorに依存せずcustomIdだけで状態を復元できる形にする。
 */
export function parseConsentCustomId(customId: string): ConsentCustomId | null {
  if (!customId.startsWith(CONSENT_CUSTOM_ID_PREFIX)) return null;
  const rest = customId.slice(CONSENT_CUSTOM_ID_PREFIX.length);
  const [version, action, userId] = rest.split(':');
  if (version !== 'v1' && version !== 'v2') return null;
  if (action !== 'yes' && action !== 'no' && action !== 'web') return null;
  if (!userId || !/^\d{17,20}$/.test(userId)) return null;
  return { action, userId, transcriptRetention: CONSENT_CUSTOM_ID_VERSIONS[version] };
}

export function buildConsentActionRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CURRENT_CONSENT_CUSTOM_ID_PREFIX}yes:${userId}`)
      .setLabel('同意する')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CURRENT_CONSENT_CUSTOM_ID_PREFIX}no:${userId}`)
      .setLabel('同意しない')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CURRENT_CONSENT_CUSTOM_ID_PREFIX}web:${userId}`)
      .setLabel('🔗 Webで同意する')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildConsentPromptContent(userId: string): string {
  return (
    `<@${userId}> さんはまだVC発言の文字起こしに同意していません。\n` +
    '同意すると、今後のVC Recapで発言が文字起こし・要約の対象になり、文字起こし本文はサーバーのダッシュボードで' +
    'セッション終了から30日間閲覧できる状態で保存されます(30日後に自動削除)。' +
    'いつでも`/herta-privacy voice-consent false`で取り消せ、取り消すと保存済みの本文も削除されます。'
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

  if (parsed.action === 'web') {
    // DB呼び出し(issueVoiceConsentAccess)がDiscordの初回応答期限(3秒)を超えると
    // interaction tokenが失効するため、先にdeferしてから発行・編集する。
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const content = await buildConsentWebLinkMessage(prisma, parsed.userId, logger);
    await interaction.editReply({ content });
    return;
  }

  const consent = parsed.action === 'yes';
  try {
    await setVoiceTranscriptionConsent(prisma, parsed.userId, consent, {
      transcriptRetention: parsed.transcriptRetention,
    });
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
      : '🔒 同意しませんでした。今後も発言は録音・文字起こしされず、保存済みの本文があれば削除しました。',
    components: [],
  });
}

/**
 * 専用URL(マジックリンク)を発行し、本人向けのephemeralメッセージ本文を組み立てる。
 * ボタン(`herta:consent:v1:web:<userId>`)と`/herta-privacy web-link`コマンドの両方から
 * 同じ発行フローを呼べるよう、応答方法(reply/editReply)は呼び出し元に委ねる。
 */
export async function buildConsentWebLinkMessage(
  prisma: PrismaClient,
  userId: string,
  logger: Logger,
): Promise<string> {
  const base = resolveStudioPublicBaseUrl();
  if (!base) {
    logger.warn('STUDIO_PUBLIC_BASE_URLが未設定のためVC同意用URLを発行できません');
    return '同意用URLは現在利用できません。管理者に設定を確認してください。';
  }

  const access = await issueVoiceConsentAccess(prisma, userId);
  const url = new URL(`/consent/${access.token}`, base);
  return [
    'こちらのURLからVC発言の文字起こしへの同意状態を変更できます。',
    `<${url.toString()}>`,
    'このURLは30分有効です。URLを知っている人は同意状態を変更できるため、共有しないでください。再発行すると以前のURLは無効になります。',
  ].join('\n');
}
