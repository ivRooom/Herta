import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { listValorantAgents, type PrismaClient } from '@herta/db';
import {
  VALORANT_REGIONS,
  legacyValorantAgents,
  valorantManifest,
  type ValorantRegion,
} from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler } from '@herta/plugin-sdk';
import {
  deleteValorantLink,
  getValorantLink,
  upsertValorantLink,
  type ValorantLinkRecord,
} from './valorant-repository.js';
import { fetchValorantMmr, parseRiotId, type RiotIdInput } from './valorant-client.js';
import { pickRandomValorantAgents } from './valorant-random.js';

export interface ValorantPluginConfig {
  enabled: boolean;
  enabledAgents: string[];
}

export function normalizeValorantConfig(value: unknown): ValorantPluginConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    enabledAgents: legacyValorantAgents(source.enabledAgents),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValorantRegion(value: string): value is ValorantRegion {
  return (VALORANT_REGIONS as readonly string[]).includes(value);
}

/**
 * HenrikDev APIのAPI Key。guild単位ではなくHerta全体で共有する環境変数とする
 * (per-guild secretにする運用上のメリットがなく、SSM配線が1本で済む)。
 */
export function resolveHenrikDevApiKey(): string | null {
  const key = process.env['HENRIKDEV_API_KEY']?.trim();
  return key ? key : null;
}

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleLink(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
): Promise<void> {
  const raw = interaction.options.getString('riot_id', true);
  const region = interaction.options.getString('region', true);
  const riotId = parseRiotId(raw);
  if (!riotId) {
    await replyEphemeral(
      interaction,
      'Riot IDの形式が正しくありません。`Name#Tag`の形式で入力してください（例: Player#JP1）。',
    );
    return;
  }
  if (!isValorantRegion(region)) {
    await replyEphemeral(interaction, '対応していないregionです。');
    return;
  }

  await upsertValorantLink(prisma, interaction.guildId!, interaction.user.id, riotId, region);
  await replyEphemeral(
    interaction,
    `Riot ID \`${riotId.name}#${riotId.tag}\`（${region}）を連携しました。`,
  );
}

async function handleUnlink(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
): Promise<void> {
  const deleted = await deleteValorantLink(prisma, interaction.guildId!, interaction.user.id);
  await replyEphemeral(
    interaction,
    deleted ? '連携を解除しました。' : '連携済みのRiot IDが見つかりませんでした。',
  );
}

async function handleMyId(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
): Promise<void> {
  const link = await getValorantLink(prisma, interaction.guildId!, interaction.user.id);
  await replyEphemeral(
    interaction,
    link
      ? `連携中のRiot ID: \`${link.riotName}#${link.riotTag}\`（${link.region}）`
      : '連携済みのRiot IDがありません。`/valorant link` で連携してください。',
  );
}

async function handleRandom(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, 'サーバー内でのみ利用できます。');
    return;
  }

  // Defer privately BEFORE network/DB calls. Complete that response before any public follow-up.
  if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId: interaction.guildId!, pluginId: 'valorant' } },
    });
    const config = normalizeValorantConfig(plugin?.config);
    if (!plugin?.enabled || !config.enabled) {
      await interaction.editReply('Valorant Pluginは現在無効です。');
      return;
    }
    if (
      interaction.appPermissions &&
      !interaction.appPermissions.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
    ) {
      await interaction.editReply(
        '結果を表示するチャンネルの閲覧・メッセージ送信・埋め込みリンク権限をBotに付与してください。',
      );
      return;
    }
    const invoker = await interaction.guild.members.fetch({
      user: interaction.user.id,
      force: true,
    });
    const channel = invoker?.voice.channel;
    if (!channel) {
      await interaction.editReply('先にボイスチャンネルへ参加してください。');
      return;
    }

    const voiceMembers = await Promise.all(
      [...channel.guild.voiceStates.cache.values()]
        .filter((state) => state.channelId === channel.id)
        .map((state) => state.member ?? channel.guild.members.fetch(state.id)),
    );
    const participants = voiceMembers.flatMap((member) =>
      member && !member.user.bot ? [member] : [],
    );
    if (!participants.some((member) => member.id === interaction.user.id)) {
      await interaction.editReply('VCの参加者を確認できません。再接続してお試しください。');
      return;
    }

    const stored = await listValorantAgents(prisma, interaction.guildId!);
    const agents =
      stored === null
        ? config.enabledAgents.map((name) => ({ agentId: name, displayName: name, enabled: true }))
        : stored.filter((agent) => agent.enabled);
    if (agents.length === 0) {
      await interaction.editReply(
        '有効なエージェントがありません。Herta Studioでエージェントを登録・有効化してください。',
      );
      return;
    }
    // Do not publish a partial roster if users changed VC during the fetch.
    const currentIds = [...channel.guild.voiceStates.cache.values()]
      .filter((state) => state.channelId === channel.id)
      .map((state) => state.id)
      .sort();
    const fetchedIds = voiceMembers.map((member) => member.id).sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(fetchedIds)) {
      await interaction.editReply('VCの参加者が変更されました。もう一度実行してください。');
      return;
    }
    const result = pickRandomValorantAgents(
      participants.map((member) => member.id),
      agents.map((agent) => agent.agentId),
    );
    if (result.status === 'no_participants') {
      await interaction.editReply('VCに抽選対象のメンバーがいません。');
      return;
    }
    if (result.status === 'not_enough_agents') {
      await interaction.editReply(
        `登録済みAgentが不足しています（${result.available}名 / VC参加者${result.required}名）。Herta Studioで抽選対象Agentを追加してください。`,
      );
      return;
    }

    const names = new Map(agents.map((agent) => [agent.agentId, agent.displayName]));
    const lines = result.assignments.map(
      ({ userId, agent }, index) =>
        `${index + 1}. <@${userId}> — **${escapeMarkdown(names.get(agent)!)}**`,
    );
    const chunks: string[] = [];
    for (const line of lines) {
      const last = chunks.length - 1;
      if (last < 0 || chunks[last]!.length + line.length + 1 > 3500) chunks.push(line);
      else chunks[last] += `\n${line}`;
    }
    // Editing first avoids Discord treating the first follow-up as the private deferred original.
    await interaction.editReply('抽選が完了しました。結果をこのチャンネルに公開します。');
    for (const chunk of chunks) {
      const embed = new EmbedBuilder()
        .setColor(0xff4655)
        .setTitle('🎲 VALORANT Agent Random')
        .setDescription(chunk)
        .setFooter({
          text: `${channel.name} • ${result.assignments.length}人 / Agent候補${agents.length}名`,
        });

      await interaction.followUp({ embeds: [embed], flags: [], allowedMentions: { parse: [] } });
    }
  } catch {
    await interaction.editReply(
      'Discordまたはデータベースから情報を取得・表示できませんでした。Botの接続と権限を確認して再試行してください。',
    );
  }
}

function tierEmoji(tierName: string): string {
  const normalized = tierName.toLowerCase();
  if (normalized.includes('radiant')) return '🌟';
  if (normalized.includes('immortal')) return '🔺';
  if (normalized.includes('ascendant')) return '🟢';
  if (normalized.includes('diamond')) return '💎';
  if (normalized.includes('platinum')) return '🔷';
  if (normalized.includes('gold')) return '🟡';
  if (normalized.includes('silver')) return '⚪';
  if (normalized.includes('bronze')) return '🟤';
  if (normalized.includes('iron')) return '⚫';
  return '🎯';
}

async function handleStats(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
): Promise<void> {
  const apiKey = resolveHenrikDevApiKey();
  if (!apiKey) {
    await replyEphemeral(interaction, 'Valorant戦績確認は現在利用できません（API Key未設定）。');
    return;
  }

  const rawRiotId = interaction.options.getString('riot_id');
  const rawRegion = interaction.options.getString('region');
  const targetUser = interaction.options.getUser('user');

  if ((rawRiotId && !rawRegion) || (!rawRiotId && rawRegion)) {
    await replyEphemeral(interaction, 'riot_idとregionは両方指定してください。');
    return;
  }

  let riotId: RiotIdInput;
  let region: ValorantRegion;
  let displayName: string;

  if (rawRiotId && rawRegion) {
    const parsed = parseRiotId(rawRiotId);
    if (!parsed || !isValorantRegion(rawRegion)) {
      await replyEphemeral(interaction, 'riot_idまたはregionの形式が正しくありません。');
      return;
    }
    riotId = parsed;
    region = rawRegion;
    displayName = `${parsed.name}#${parsed.tag}`;
  } else {
    const lookupUserId = targetUser?.id ?? interaction.user.id;
    const link: ValorantLinkRecord | null = await getValorantLink(
      prisma,
      interaction.guildId!,
      lookupUserId,
    );
    if (!link) {
      await replyEphemeral(
        interaction,
        targetUser
          ? 'そのユーザーは連携済みのRiot IDがありません。'
          : '連携済みのRiot IDがありません。`/valorant link` で連携するか、riot_id/regionを直接指定してください。',
      );
      return;
    }
    riotId = { name: link.riotName, tag: link.riotTag };
    region = link.region;
    displayName = targetUser ? `<@${targetUser.id}>` : `<@${interaction.user.id}>`;
  }

  await interaction.deferReply();
  const result = await fetchValorantMmr(apiKey, region, riotId);

  if (result.status === 'not_found') {
    await interaction.followUp({
      content: `\`${riotId.name}#${riotId.tag}\` のプレイヤーが見つかりませんでした。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.status === 'rate_limited') {
    await interaction.followUp({
      content: '現在リクエストが混み合っています。しばらくしてから再度お試しください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.status === 'upstream_error') {
    await interaction.followUp({
      content: '戦績の取得に失敗しました。しばらくしてから再度お試しください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { snapshot } = result;
  const embed = new EmbedBuilder()
    .setTitle(`${tierEmoji(snapshot.currentTierName)} ${displayName} の戦績`)
    .setColor(0xff4655)
    .addFields(
      { name: 'Riot ID', value: `${snapshot.name}#${snapshot.tag}`, inline: true },
      { name: 'Region', value: region, inline: true },
      { name: 'Rank', value: snapshot.currentTierName, inline: true },
      { name: 'RR', value: `${snapshot.currentRr}`, inline: true },
    );
  if (snapshot.currentElo !== null) {
    embed.addFields({ name: 'Elo', value: `${snapshot.currentElo}`, inline: true });
  }
  if (snapshot.peakTierName) {
    embed.addFields({ name: 'Peak Rank', value: snapshot.peakTierName, inline: true });
  }
  embed.setFooter({ text: 'Powered by HenrikDev API' });

  await interaction.followUp({ embeds: [embed], allowedMentions: { parse: [] } });
}

export const valorantPlugin = definePlugin<ValorantPluginConfig, unknown, PrismaClient>({
  manifest: valorantManifest,
  provideCommands(context) {
    return [
      {
        definition: valorantManifest.commands[0]!,
        async execute(interaction) {
          if (!normalizeValorantConfig(context.config).enabled) {
            await replyEphemeral(interaction, 'Valorant Pluginは現在無効です。');
            return;
          }
          if (!interaction.guildId) {
            await replyEphemeral(interaction, 'サーバー内でのみ利用できます。');
            return;
          }

          const subcommand = interaction.options.getSubcommand();
          if (subcommand === 'link') {
            await handleLink(interaction, context.prisma);
          } else if (subcommand === 'unlink') {
            await handleUnlink(interaction, context.prisma);
          } else if (subcommand === 'myid') {
            await handleMyId(interaction, context.prisma);
          } else if (subcommand === 'stats') {
            await handleStats(interaction, context.prisma);
          } else if (subcommand === 'random') {
            await handleRandom(interaction, context.prisma);
          } else {
            await replyEphemeral(interaction, '未対応のサブコマンドです。');
          }
        },
      } as CommandHandler<ChatInputCommandInteraction>,
    ];
  },
});
