import { AttachmentBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import {
  deleteUserVoiceData,
  getPrismaClient,
  getUserDataConsent,
  listVcRecapSessionsForUser,
  setVoiceTranscriptionConsent,
} from '@herta/db';
import { revokeVcRecapConsent } from '../voice/vc-recap-session-manager.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

async function executeVoiceConsent(interaction: ChatInputCommandInteraction) {
  const consent = interaction.options.getBoolean('consent', true);
  await setVoiceTranscriptionConsent(prisma, interaction.user.id, consent);
  if (!consent) revokeVcRecapConsent(interaction.user.id);
  await interaction.reply({
    content: consent
      ? '✅ VC発言の文字起こしに同意しました。`/vc-recap start`実行時、あなたの発言が要約生成の対象になります。'
      : '🔒 VC発言の文字起こしへの同意を取り消しました。以後、あなたの発言は録音・文字起こしの対象外になります。',
    flags: MessageFlags.Ephemeral,
  });
}

async function executeDeleteVoiceData(interaction: ChatInputCommandInteraction) {
  const result = await deleteUserVoiceData(prisma, interaction.user.id);
  await interaction.reply({
    content:
      `🗑️ VC要約データの削除を実行しました。` +
      `\n- あなた単独のセッション: ${result.deletedSessions}件 削除` +
      `\n- 他の参加者もいたセッション: ${result.redactedSessions}件からあなたの参加記録を除去(要約は複数人の発言から生成されているため、他の参加者の分も含めて併せて削除しました)`,
    flags: MessageFlags.Ephemeral,
  });
}

async function executeExport(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const consent = await getUserDataConsent(prisma, interaction.user.id);
  const sessions = await listVcRecapSessionsForUser(prisma, interaction.user.id);

  const exportPayload = {
    userId: interaction.user.id,
    exportedAt: new Date().toISOString(),
    consent: {
      voiceTranscriptionConsent: consent.voiceTranscriptionConsent,
      updatedAt: consent.updatedAt.toISOString(),
    },
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
        description: 'VC発言の文字起こし(/vc-recap)への同意を切り替えます',
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
        name: 'delete-voice-data',
        description: 'あなたが参加したVC要約データの削除を依頼します',
      },
      {
        name: 'export',
        description: 'Hertaが保持しているあなたのデータをJSONでエクスポートします',
      },
    ],
  },
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'voice-consent') {
      await executeVoiceConsent(interaction);
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
