import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type VoiceBasedChannel,
  type VoiceState,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { listVcRecapSessions } from '@herta/db';
import { vcRecapManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  buildConsentActionRow,
  buildConsentPromptContent,
} from '../voice/vc-recap-consent-interaction.js';
import {
  activeVcRecapChannelId,
  isVcRecapActive,
  startVcRecap,
  stopVcRecap,
} from '../voice/vc-recap-session-manager.js';

export interface VcRecapConfig {
  enabled: boolean;
  excludedChannelIds: string[];
  autoConsentRoleIds: string[];
}

// Discordの埋め込みdescription上限は4096文字。summaryは最大2000文字・limitは最大10件の
// ため、1件あたりの表示を切り詰めずに結合すると上限を超えうる。1件ごとに切り詰めた上、
// 念のため結合後も上限内に収める。
const EMBED_DESCRIPTION_LIMIT = 4_096;
const SUMMARY_PREVIEW_CHARS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizedIds(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const idPattern = /^\d+$/;
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === 'string' && idPattern.test(item)),
    ),
  ].slice(0, maxItems);
}

export function normalizeVcRecapConfig(value: unknown): VcRecapConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === true,
    excludedChannelIds: normalizedIds(source.excludedChannelIds, 50),
    autoConsentRoleIds: normalizedIds(source.autoConsentRoleIds, 50),
  };
}

type VcRecapRuntimeContext = PluginRuntimeContext<VcRecapConfig, Client, PrismaClient>;

async function resolveVoiceChannel(
  interaction: ChatInputCommandInteraction,
): Promise<VoiceBasedChannel | null> {
  if (!interaction.guild) return null;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return member?.voice.channel ?? null;
}

async function sendConsentPrompts(
  channel: VoiceBasedChannel,
  nonConsentingUserIds: string[],
): Promise<void> {
  for (const userId of nonConsentingUserIds) {
    await channel
      .send({
        content: buildConsentPromptContent(userId),
        components: [buildConsentActionRow(userId)],
        allowedMentions: { users: [userId] },
      })
      .catch(() => undefined);
  }
}

async function executeStart(
  context: VcRecapRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const config = normalizeVcRecapConfig(context.config);
  if (!config.enabled) {
    await interaction.reply({
      content: 'このサーバーではVC Recapが無効化されています。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await resolveVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: 'VCに参加してから実行してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (config.excludedChannelIds.includes(channel.id)) {
    await interaction.reply({
      content: 'このVCは記録対象から除外されています。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await startVcRecap(
    context.prisma,
    context.logger,
    channel,
    interaction.user.id,
    config.autoConsentRoleIds,
  );

  if (result.status === 'already_active') {
    await interaction.editReply('既にこのサーバーで記録中です。`/vc-recap stop`で終了できます。');
    return;
  }
  if (result.status === 'no_consenting_members') {
    await sendConsentPrompts(channel, result.nonConsentingUserIds);
    await interaction.editReply(
      '現在このVCに同意済みのメンバーがいないため、記録を開始できません。' +
        '上記のボタンから同意するか、`/herta-privacy voice-consent true`で同意できます。',
    );
    return;
  }
  if (result.status === 'connection_failed') {
    await interaction.editReply('VCへの接続に失敗しました。時間をおいて再度お試しください。');
    return;
  }

  const announcement = new EmbedBuilder()
    .setTitle('🎙️ VC Recapを開始しました')
    .setDescription(
      'この通話の要約を記録します。同意していない方の発言は記録されません。' +
        `\n記録対象: ${result.consentingCount}名 / 未同意: ${result.nonConsentingUserIds.length}名`,
    )
    .setColor(0x5865f2);
  await channel.send({ embeds: [announcement] }).catch(() => undefined);
  await sendConsentPrompts(channel, result.nonConsentingUserIds);

  await interaction.editReply(
    '記録を開始しました。終了するには`/vc-recap stop`を実行してください。',
  );
}

async function executeStop(
  context: VcRecapRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await stopVcRecap(context.prisma, context.logger, interaction.guildId);
  if (result.status === 'not_active') {
    await interaction.editReply('現在記録中のVC Recapはありません。');
    return;
  }
  if (result.status === 'summarize_failed') {
    await interaction.editReply(
      '記録を終了しましたが、要約の生成に失敗しました(発言が無かった可能性があります)。',
    );
    return;
  }
  await interaction.editReply('記録を終了し、要約を生成しました。`/vc-recap list`で確認できます。');
}

async function executeList(
  context: VcRecapRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) return;
  // 要約には参加者の発言内容が含まれるため、activity-logと同様にManageGuildを要求する
  // (manifestが宣言する`vc-recap.view`権限のこのコードベースでの対応付け)。
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'このコマンドの実行にはサーバー管理権限が必要です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const limit = interaction.options.getInteger('limit') ?? 5;

  const result = await listVcRecapSessions(context.prisma, {
    guildId: interaction.guildId,
    pageSize: limit,
  });

  if (result.items.length === 0) {
    await interaction.reply({
      content: 'まだVC Recapの記録がありません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = result.items.map((session) => {
    const timestamp = `<t:${Math.floor(session.startedAt.getTime() / 1000)}:R>`;
    if (session.status !== 'completed' || !session.summary) {
      return `${timestamp} <#${session.channelId}> — (要約なし、ステータス: ${session.status})`;
    }
    const preview =
      session.summary.length > SUMMARY_PREVIEW_CHARS
        ? `${session.summary.slice(0, SUMMARY_PREVIEW_CHARS)}…`
        : session.summary;
    return `${timestamp} <#${session.channelId}>\n> ${preview}`;
  });

  let description = lines.join('\n\n');
  if (description.length > EMBED_DESCRIPTION_LIMIT) {
    description = `${description.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…`;
  }

  const embed = new EmbedBuilder()
    .setTitle('📜 VC Recap 直近の記録')
    .setDescription(description)
    .setColor(0x5865f2);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleVoiceStateUpdate(
  context: VcRecapRuntimeContext,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const config = normalizeVcRecapConfig(context.config);
  if (!config.enabled) return;
  if (!isVcRecapActive(context.guildId)) return;

  const activeChannelId = activeVcRecapChannelId(context.guildId);
  if (!activeChannelId) return;
  // 記録中チャンネルに関係の無い状態変化は無視する。
  if (oldState.channelId !== activeChannelId && newState.channelId !== activeChannelId) return;

  const channel = oldState.guild.channels.cache.get(activeChannelId);
  if (!channel?.isVoiceBased()) return;
  const remainingHumans = channel.members.filter((member) => !member.user.bot).size;
  if (remainingHumans > 0) return;

  await stopVcRecap(context.prisma, context.logger, context.guildId);
}

export const vcRecapPlugin = definePlugin<VcRecapConfig, Client, PrismaClient>({
  manifest: vcRecapManifest,
  async onDisable(context) {
    // guild管理者がPluginを無効化・再設定した場合でも、独立して保持しているVC接続と
    // activeSessionsのエントリは自動では消えない。無効化時に明示的に記録を終了する
    // (無効化後は`/vc-recap stop`自体も呼べなくなるため、ここで止めないと録音が残り続ける)。
    if (!isVcRecapActive(context.guildId)) return;
    await stopVcRecap(context.prisma, context.logger, context.guildId);
  },
  provideCommands(context) {
    return [
      {
        definition: vcRecapManifest.commands[0]!,
        async execute(interaction) {
          const subcommand = interaction.options.getSubcommand();
          if (subcommand === 'start') {
            await executeStart(context, interaction);
            return;
          }
          if (subcommand === 'stop') {
            await executeStop(context, interaction);
            return;
          }
          if (subcommand === 'list') {
            await executeList(context, interaction);
            return;
          }
          await interaction.reply({
            content: '不明な操作です。',
            flags: MessageFlags.Ephemeral,
          });
        },
      } as CommandHandler<ChatInputCommandInteraction>,
    ];
  },
  provideEvents(context) {
    return [
      {
        event: 'voiceStateUpdate',
        async handler(_ctx, ...args) {
          await handleVoiceStateUpdate(context, args[0] as VoiceState, args[1] as VoiceState);
        },
      },
    ];
  },
});
