import { AttachmentBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import {
  deleteUserVoiceData,
  getPrismaClient,
  hasDailyBonusSchema,
  getUserDataConsent,
  listVcRecapSessionsForUser,
  listVcRecapTranscriptSegmentsForUser,
  requestVcRecapErasure,
  setVoiceTranscriptionConsent,
  setVcRecapOpenAiAudioConsent,
} from '@herta/db';
import { createLogger, type Logger } from '@herta/logger';
import { buildConsentWebLinkMessage } from '../voice/vc-recap-consent-interaction.js';
import { revokeVcRecapConsent } from '../voice/vc-recap-session-manager.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

let sharedLogger: Logger | undefined;
function getSharedLogger(): Logger {
  sharedLogger ??= createLogger({ name: 'herta-bot-privacy', level: process.env['BOT_LOG_LEVEL'] });
  return sharedLogger;
}

async function executeVoiceConsent(interaction: ChatInputCommandInteraction) {
  const consent = interaction.options.getBoolean('consent', true);
  // コマンドの説明文で本文の30日保存を案内しているため、同意は本文保存への同意も兼ねる。
  await setVoiceTranscriptionConsent(prisma, interaction.user.id, consent, {
    transcriptRetention: true,
  });
  if (!consent) revokeVcRecapConsent(interaction.user.id);
  await interaction.reply({
    content: consent
      ? '✅ VC発言の文字起こしに同意しました。`/vc-recap start`実行時、あなたの発言が要約生成の対象になり、' +
        '文字起こし本文はサーバーのダッシュボードでセッション終了から30日間閲覧できます(30日後に自動削除)。'
      : '🔒 VC発言の文字起こしへの同意を取り消しました。以後、あなたの発言は録音・文字起こしの対象外になり、' +
        '保存済みの文字起こし本文も削除しました。',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * The Discord option description is presented before submission and points
 * to the full privacy policy. No older AWS voice consent is automatically
 * treated as permission to send raw voice to OpenAI.
 */
async function executeOpenAiAudioConsent(interaction: ChatInputCommandInteraction) {
  const accept = interaction.options.getBoolean('consent', true);
  const updated = await setVcRecapOpenAiAudioConsent(prisma, interaction.user.id, accept);
  if (!updated) {
    await interaction.reply({
      content:
        '新しい音声送信同意を登録できません。文字起こし同意または削除依頼の状態を確認してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!accept) revokeVcRecapConsent(interaction.user.id);
  await interaction.reply({
    content: accept
      ? '✅ OpenAIへの音声送信に個別に同意しました。Herta側でOpenAI文字起こしを有効化した場合のみ、あなたの音声がOpenAI APIへ送信されます。生の音声ファイルはHertaで永続保存しません。旧AWS同意や長期録音同意とは別です。https://ivrm.jp/privacy'
      : '🔒 OpenAIへの音声送信の同意を取り消しました。以後のOpenAIへの音声送信は行いません。既存の文字起こし本文を削除する場合は /herta-privacy delete-voice-data を実行してください。',
    flags: MessageFlags.Ephemeral,
  });
}

async function executeDeleteVoiceData(interaction: ChatInputCommandInteraction) {
  // Deny future archive/recording writes before removing current PostgreSQL data.
  // S3 deletion is NOT reported complete until object versions and restores are verified.
  await requestVcRecapErasure(prisma, interaction.user.id);
  // Stop existing voice capture as well: otherwise an active stream could
  // recreate the transcript after deletion while consent stays enabled.
  revokeVcRecapConsent(interaction.user.id);
  // deleteUserVoiceData must inspect segments BEFORE consent revocation clears them:
  // segments-only sessions would otherwise be missed by summary redaction.
  const result = await deleteUserVoiceData(prisma, interaction.user.id);
  await setVoiceTranscriptionConsent(prisma, interaction.user.id, false);
  await interaction.reply({
    content:
      `🗑️ VC要約データの削除を実行しました。文字起こしへの同意も取り消しました。` +
      `\n- あなた単独のセッション: ${result.deletedSessions}件 削除` +
      `\n- 他の参加者もいたセッション: ${result.redactedSessions}件からあなたの参加記録を除去(要約は複数人の発言から生成されているため、他の参加者の分も含めて併せて削除しました)`,
    flags: MessageFlags.Ephemeral,
  });
}

async function executeWebLink(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const content = await buildConsentWebLinkMessage(prisma, interaction.user.id, getSharedLogger());
  await interaction.editReply(content);
}

async function executeExport(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [consent, sessions, transcriptSegments, explicitConsents, erasureRequest, mbtiResults] =
    await Promise.all([
      getUserDataConsent(prisma, interaction.user.id),
      listVcRecapSessionsForUser(prisma, interaction.user.id),
      listVcRecapTranscriptSegmentsForUser(prisma, interaction.user.id),
      prisma.vcRecapExplicitConsent.findMany({
        where: { userId: interaction.user.id },
        select: {
          purpose: true,
          policyVersion: true,
          consentedAt: true,
          revokedAt: true,
          updatedAt: true,
        },
        orderBy: { purpose: 'asc' },
      }),
      prisma.vcRecapErasureRequest.findUnique({
        where: { userId: interaction.user.id },
        select: {
          requestedAt: true,
          storageDeletionVerifiedAt: true,
          updatedAt: true,
        },
      }),
      prisma.mbtiPersonalResult.findMany({
        where: { discordUserId: interaction.user.id },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          guildId: true,
          resultType: true,
          resultIdentity: true,
          scores: true,
          percentages: true,
          questionCount: true,
          scoringVersion: true,
          source: true,
          completedAt: true,
        },
      }),
    ]);

  const exportPayload = {
    userId: interaction.user.id,
    exportedAt: new Date().toISOString(),
    mbtiResults,
    dailyFortunes: (await hasDailyBonusSchema(prisma))
      ? await prisma.$queryRaw`SELECT guild_id,target_date,algorithm_version,result_json,created_at FROM daily_fortune_results WHERE discord_user_id=${interaction.user.id} ORDER BY target_date DESC`
      : [],
    dailyBonusReceipts: (await hasDailyBonusSchema(prisma))
      ? await prisma.$queryRaw`SELECT guild_id,target_date,status,receipt_json,created_at FROM daily_bonus_claims WHERE discord_user_id=${interaction.user.id} ORDER BY target_date DESC`
      : [],
    consent: {
      voiceTranscriptionConsent: consent.voiceTranscriptionConsent,
      voiceTranscriptRetentionConsentedAt:
        consent.voiceTranscriptRetentionConsentedAt?.toISOString() ?? null,
      updatedAt: consent.updatedAt.toISOString(),
    },
    explicitVoiceConsents: explicitConsents.map((record) => ({
      purpose: record.purpose,
      policyVersion: record.policyVersion,
      consentedAt: record.consentedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString(),
    })),
    voiceErasureRequest: erasureRequest
      ? {
          requestedAt: erasureRequest.requestedAt.toISOString(),
          storageDeletionVerifiedAt:
            erasureRequest.storageDeletionVerifiedAt?.toISOString() ?? null,
          updatedAt: erasureRequest.updatedAt.toISOString(),
        }
      : null,
    voiceRecapSessions: sessions.map((session) => ({
      id: session.id,
      guildId: session.guildId,
      channelId: session.channelId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      status: session.status,
      summary: session.summary,
      topics: session.topics,
      wasConsenting: session.wasConsenting,
    })),
    voiceTranscriptSegments: transcriptSegments.map((segment) => ({
      sessionId: segment.sessionId,
      text: segment.text,
      startedAt: segment.startedAt.toISOString(),
      endedAt: segment.endedAt.toISOString(),
    })),
  };

  const attachment = new AttachmentBuilder(
    Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8'),
    { name: 'herta-data-export.json' },
  );

  await interaction.editReply({
    content: '📦 あなたに関連するデータのエクスポートです。',
    files: [attachment],
  });
}

export const privacyCommand: SlashCommand = {
  definition: {
    name: 'herta-privacy',
    description: 'Hertaが保持しているあなたのデータの確認・同意設定・削除依頼を行います',
    subcommands: [
      {
        name: 'voice-consent',
        description: 'VC発言の文字起こし(/vc-recap)と本文の30日保存への同意を切り替えます',
        options: [
          {
            name: 'consent',
            description: '同意する場合はtrue',
            type: 'boolean',
            required: true,
          },
        ],
      },
      {
        name: 'openai-audio-consent',
        description: 'OpenAIへVCの生音声を送信する場合の本人同意を変更します',
        options: [
          {
            name: 'consent',
            description: 'OpenAIに発言音声を送信することへ同意。詳細: https://ivrm.jp/privacy',
            type: 'boolean',
            required: true,
          },
        ],
      },
      {
        name: 'web-link',
        description: 'VC発言の文字起こし同意状態を変更できる専用URLを発行します(30分有効)',
      },
      {
        name: 'delete-voice-data',
        description: 'あなたが参加したVC要約データの削除を依頼します',
      },
      {
        name: 'export',
        description: '本人のVC・MBTI履歴・デイリーボーナス・占い結果をJSONで取得します',
      },
    ],
  },
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'voice-consent') {
      await executeVoiceConsent(interaction);
      return;
    }
    if (subcommand === 'openai-audio-consent') {
      await executeOpenAiAudioConsent(interaction);
      return;
    }
    if (subcommand === 'web-link') {
      await executeWebLink(interaction);
      return;
    }
    if (subcommand === 'delete-voice-data') {
      await executeDeleteVoiceData(interaction);
      return;
    }
    if (subcommand === 'export') {
      await executeExport(interaction);
      return;
    }
    await interaction.reply({
      content: '不明な操作です。',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const privacyCommands = [privacyCommand];
