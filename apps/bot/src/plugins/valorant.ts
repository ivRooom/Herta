import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { listValorantAgents, type PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import {
  VALORANT_REGIONS,
  defaultValorantAgents,
  legacyValorantAgents,
  valorantManifest,
  type ValorantRegion,
} from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginEventHandler } from '@herta/plugin-sdk';
import {
  deleteValorantLink,
  getValorantLink,
  upsertValorantLink,
  type ValorantLinkRecord,
} from './valorant-repository.js';
import { fetchValorantMmr, parseRiotId, type RiotIdInput } from './valorant-client.js';
import { pickRandomValorantAgents } from './valorant-random.js';
import { renderValorantPickCard } from './valorant-pick-card.js';
import {
  createValorantSession,
  createDirectValorantSession,
  rerollValorantSession,
  getValorantSession,
  mutateValorantSession,
  parseValorantSessionAction,
  setValorantSessionMessageId,
  VALORANT_SESSION_PREFIX,
  type ValorantCandidate,
  type ValorantAssignment,
  type ValorantSessionSnapshot,
} from './valorant-session-repository.js';
import {
  japaneseValorantMap,
  tacticalMapPlan,
  pickTacticalAgents,
  VALORANT_COMPOSITION_VERSION,
  VALORANT_MAPS,
} from './valorant-maps.js';

export interface ValorantPluginConfig {
  enabled: boolean;
  enabledAgents: string[];
  maxParticipants: number;
  sessionDurationMinutes: number;
}

export function normalizeValorantConfig(value: unknown): ValorantPluginConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    enabledAgents: legacyValorantAgents(source.enabledAgents),
    maxParticipants:
      typeof source.maxParticipants === 'number' && Number.isInteger(source.maxParticipants)
        ? Math.max(1, Math.min(5, source.maxParticipants))
        : 5,
    sessionDurationMinutes:
      typeof source.sessionDurationMinutes === 'number' &&
      Number.isInteger(source.sessionDurationMinutes)
        ? Math.max(5, Math.min(180, source.sessionDurationMinutes))
        : 30,
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

function buildValorantSessionMessage(session: ValorantSessionSnapshot) {
  const closed = session.status !== 'OPEN' || session.expiresAt <= new Date();
  const members = session.participants.map((item) => item.userId);
  const result = Array.isArray(session.result) ? session.result : [];
  const assignments = result.filter(
    (item): item is { userId: string; agentId: string; displayName: string } =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof item.userId === 'string' &&
      typeof item.agentId === 'string' &&
      typeof item.displayName === 'string',
  );
  const lines =
    session.status === 'COMPLETED' && assignments.length > 0
      ? assignments.map(
          (item) => '<@' + item.userId + '> — **' + escapeMarkdown(item.displayName) + '**',
        )
      : members.map((id) => '👤 <@' + id + '>');
  const description = [
    'モード：' + (session.mode === 'TACTICAL' ? '実戦向け構成' : '完全ランダム'),
    'マップ：' + japaneseValorantMap(session.mapId),
    '参加者：' + members.length + ' / ' + session.maxParticipants,
    '',
    lines.length ? lines.join('\n') : '参加者はいません',
  ];
  if (session.mode === 'TACTICAL' && session.status === 'COMPLETED') {
    const map = VALORANT_MAPS.find(([id]) => id === session.mapId)?.[0];
    const plan = map ? tacticalMapPlan(map) : null;
    description.push(
      '',
      plan
        ? '構成の特徴：' + plan.label + ' — ' + plan.focus
        : '構成の特徴：エントリー・スモーク・索敵・防衛と連携を考慮。',
      '※構成は戦術的な候補例です。プロ大会の採用率・勝率を保証するものではありません。',
    );
    if (members.length < 5) description.push('※5人編成としては未完成です。');
  }
  description.push(
    '',
    '状態：' + (session.status === 'OPEN' && closed ? '期限切れ' : ({ OPEN: '参加募集中', COMPLETED: '抽選完了', CANCELLED: '募集取消', EXPIRED: '期限切れ' }[session.status] ?? session.status)),
  );
  const embed = new EmbedBuilder()
    .setColor(0xff4655)
    .setTitle('🎮 VALORANT エージェント抽選')
    .setDescription(description.join('\n'))
    .setTimestamp(session.completedAt ?? session.createdAt);
  const button = (action: string, label: string, style: ButtonStyle, disabled: boolean) =>
    new ButtonBuilder()
      .setCustomId(VALORANT_SESSION_PREFIX + session.id + ':' + action)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  const components =
    session.status === 'COMPLETED'
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            button('reroll', '再抽選', ButtonStyle.Primary, session.expiresAt <= new Date()),
          ),
        ]
      : session.status === 'OPEN'
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              button(
                'join',
                '参加',
                ButtonStyle.Success,
                closed || members.length >= session.maxParticipants,
              ),
              button('leave', '参加取消', ButtonStyle.Secondary, closed),
              button('draw', '抽選', ButtonStyle.Primary, closed || members.length === 0),
              button('cancel', '募集取消', ButtonStyle.Danger, closed),
            ),
          ]
        : [];
  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] as [] },
  };
}

async function buildValorantRichMessage(
  session: ValorantSessionSnapshot,
  logger: Logger,
  displayName?: (userId: string) => string | undefined,
) {
  const basic = buildValorantSessionMessage(session);
  if (session.status !== 'COMPLETED' || !Array.isArray(session.result)) return basic;
  const assignments = session.result.filter(
    (item): item is { userId: string; agentName: string; displayName: string } =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof item.userId === 'string' &&
      typeof item.agentName === 'string' &&
      typeof item.displayName === 'string',
  );
  if (assignments.length === 0 || assignments.length > 5) return basic;
  const map = VALORANT_MAPS.find(([id]) => id === session.mapId)?.[0];
  try {
    const image = await renderValorantPickCard({
      mode: session.mode === 'TACTICAL' ? 'TACTICAL' : 'RANDOM',
      mapName: japaneseValorantMap(session.mapId),
      planLabel: session.mode === 'TACTICAL' && map ? tacticalMapPlan(map).label : null,
      entries: assignments.map((entry, index) => ({
        agentName: entry.agentName,
        displayName: entry.displayName,
        playerLabel: displayName?.(entry.userId) ?? `PLAYER ${index + 1}`,
      })),
    });
    basic.embeds[0]!.setImage('attachment://valorant-pick.png');
    return {
      ...basic,
      files: [new AttachmentBuilder(image, { name: 'valorant-pick.png' })],
    };
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'VALORANTピック画像生成に失敗、テキストにフォールバック',
    );
    return basic;
  }
}

function pickValorantAssignments(
  participants: string[],
  available: readonly ValorantCandidate[],
  mode: string,
  mapId: string | null,
): ValorantAssignment[] | null {
  let pool = available;
  if (mode === 'TACTICAL') {
    const selected = VALORANT_MAPS.find(([id]) => id === mapId)?.[0];
    if (!selected) return null;
    const tactical = pickTacticalAgents(
      selected,
      participants.length,
      available.map(({ agentName }) => agentName),
    );
    if (tactical.status !== 'ok') return null;
    pool = tactical.agents.map((name) => available.find((a) => a.agentName === name)!);
  }
  const result = pickRandomValorantAgents(
    participants,
    pool.map(({ agentId }) => agentId),
  );
  if (result.status !== 'ok') return null;
  return result.assignments.map(({ userId, agent }) => {
    const found = pool.find(({ agentId }) => agentId === agent)!;
    return { userId, ...found };
  });
}

async function getActiveValorantCandidates(
  prisma: PrismaClient,
  guildId: string,
  config: ValorantPluginConfig,
): Promise<ValorantCandidate[]> {
  const stored = await listValorantAgents(prisma, guildId);
  return stored === null
    ? defaultValorantAgents(config.enabledAgents)
        .filter(({ enabled }) => enabled)
        .map(({ agentId, agentName, displayName }) => ({ agentId, agentName, displayName }))
    : stored
        .filter(({ enabled }) => enabled)
        .map(({ agentId, agentName, displayName }) => ({ agentId, agentName, displayName }));
}

async function handleRandom(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await replyEphemeral(interaction, 'サーバー内のテキストチャンネルで実行してください。');
    return;
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  try {
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId: interaction.guildId!, pluginId: 'valorant' } },
    });
    const config = normalizeValorantConfig(plugin?.config);
    if (!plugin?.enabled || !config.enabled) {
      await interaction.editReply('VALORANT Pluginは現在無効です。');
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
      await interaction.editReply('Botに閲覧・送信・埋め込みリンク権限を付与してください。');
      return;
    }
    const map = interaction.options.getString('map');
    if (map !== null && !VALORANT_MAPS.some(([id]) => id === map)) {
      await interaction.editReply('未対応のマップです。');
      return;
    }
    const mode = map ? 'TACTICAL' : 'RANDOM';
    const mentioned = Array.from({ length: 5 }, (_, index) => {
      const name = `member${index + 1}`;
      return {
        user: interaction.options.getUser(name),
        member: interaction.options.getMember(name),
      };
    }).filter((entry) => entry.user !== null);
    if (mentioned.some(({ member }) => !member)) {
      await interaction.editReply('指定できるのは、このサーバーに参加しているメンバーだけです。');
      return;
    }
    const members = mentioned.map(({ user }) => user!.id);
    if (new Set(members).size !== members.length) {
      await interaction.editReply('同じメンバーを重複して指定できません。');
      return;
    }
    if (mentioned.some(({ user }) => user!.bot)) {
      await interaction.editReply('Botアカウントは抽選メンバーに指定できません。');
      return;
    }
    if (members.length > config.maxParticipants) {
      await interaction.editReply(
        `指定人数がサーバーの抽選上限（${config.maxParticipants}人）を超えています。`,
      );
      return;
    }
    const expiresAt = new Date(Date.now() + config.sessionDurationMinutes * 60_000);
    const rulesVersion = mode === 'TACTICAL' ? VALORANT_COMPOSITION_VERSION : 'fisher-yates-v1';
    if (members.length > 0) {
      const candidates = await getActiveValorantCandidates(prisma, interaction.guildId, config);
      const assignments = pickValorantAssignments(members, candidates, mode, map);
      if (!assignments) {
        await interaction.editReply(
          '指定人数に対応する有効なエージェント構成が不足しています。Studioで候補を確認してください。',
        );
        return;
      }
      const session = await createDirectValorantSession(prisma, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        creatorId: interaction.user.id,
        mode,
        mapId: map,
        expiresAt,
        rulesVersion,
        participants: members,
        candidates,
        assignments,
      });
      await interaction.editReply(
        '指定メンバーの抽選が完了しました。結果の「再抽選」ボタンで引き直せます。',
      );
      const message = await interaction.followUp({
        ...(await buildValorantRichMessage(session, logger, (id) => interaction.guild?.members.cache.get(id)?.displayName)),
        flags: [],
      });
      await setValorantSessionMessageId(prisma, interaction.guildId, session.id, message.id);
      return;
    }
    const session = await createValorantSession(prisma, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      creatorId: interaction.user.id,
      mode,
      mapId: map,
      maxParticipants: config.maxParticipants,
      expiresAt,
      rulesVersion,
    });
    await interaction.editReply('参加募集を作成しました。参加ボタンを押した人だけが抽選対象です。');
    const message = await interaction.followUp({
      ...buildValorantSessionMessage(session),
      flags: [],
    });
    await setValorantSessionMessageId(prisma, interaction.guildId, session.id, message.id);
  } catch (error) {
    logger.error(
      {
        guildId: interaction.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'VALORANT募集作成に失敗',
    );
    await interaction
      .editReply('募集の作成に失敗しました。DiscordまたはDBを確認してください。')
      .catch(() => undefined);
  }
}

async function handleValorantButton(
  interaction: ButtonInteraction,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  const parsed = parseValorantSessionAction(interaction.customId);
  if (!parsed) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply('サーバー内でのみ操作できます。');
    return;
  }
  try {
    const session = await getValorantSession(prisma, guildId, parsed.id);
    if (
      !session ||
      (session.messageId && session.messageId !== interaction.message.id) ||
      session.channelId !== interaction.channelId
    ) {
      await interaction.editReply('対象の募集が見つかりません。');
      return;
    }
    let candidates: ValorantCandidate[] = [];
    let config: ValorantPluginConfig | null = null;
    if (parsed.action === 'draw' || parsed.action === 'reroll') {
      const plugin = await prisma.guildPlugin.findUnique({
        where: { guildId_pluginId: { guildId, pluginId: 'valorant' } },
      });
      config = normalizeValorantConfig(plugin?.config);
      if (!plugin?.enabled || !config.enabled) {
        await interaction.editReply('VALORANT Pluginは現在無効です。');
        return;
      }
      candidates = await getActiveValorantCandidates(prisma, guildId, config);
    }
    const isAdmin = Boolean(
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
    );
    const mutation =
      parsed.action === 'reroll'
        ? await rerollValorantSession(prisma, {
            guildId,
            id: parsed.id,
            messageId: interaction.message.id,
            userId: interaction.user.id,
            isAdmin,
            candidates,
            sessionDurationMinutes: config!.sessionDurationMinutes,
            rulesVersion:
              session.mode === 'TACTICAL' ? VALORANT_COMPOSITION_VERSION : 'fisher-yates-v1',
            pick: pickValorantAssignments,
          })
        : await mutateValorantSession(prisma, {
            guildId,
            id: parsed.id,
            userId: interaction.user.id,
            action: parsed.action,
            isAdmin,
            candidates,
            pick: pickValorantAssignments,
          });
    if (mutation.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '募集が見つかりません。',
        closed: '募集は終了済み、再抽選の期限切れ、または結果が更新済みです。',
        full: 'この募集は定員です。',
        not_joined: 'まだ参加していません。',
        empty: '参加者がいないため抽選できません。',
        forbidden: '抽選・募集取消は作成者または管理者のみ実行できます。',
        insufficient: '有効なエージェントが不足しています。Studioで候補を確認してください。',
      };
      // Expiration can close the DB session even if the Discord UI is stale.
      if (mutation.status === 'closed') {
        const latest =
          parsed.action === 'reroll'
            ? await prisma.valorantPickSession.findUnique({
                where: { messageId: interaction.message.id },
                include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
              })
            : await getValorantSession(prisma, guildId, parsed.id);
        if (latest?.guildId === guildId)
          await interaction.message
            .edit({ ...(await buildValorantRichMessage(latest, logger)), attachments: [] })
            .catch(() => undefined);
      }
      await interaction.editReply(messages[mutation.status] ?? '操作できませんでした。');
      return;
    }
    if (mutation.changed) {
      try {
        await interaction.message.edit({
          ...(await buildValorantRichMessage(
            mutation.session,
            logger,
            (id) => interaction.guild?.members.cache.get(id)?.displayName,
          )),
          attachments: [],
        });
      } catch (error) {
        logger.warn(
          { guildId, errorName: error instanceof Error ? error.name : 'UnknownError' },
          'VALORANT募集表示の更新に失敗',
        );
        await interaction.editReply('操作はDBへ保存済みですが、Discordの表示更新に失敗しました。');
        return;
      }
    }
    await interaction.editReply(
      parsed.action === 'reroll'
        ? '同じメンバー・マップで再抽選しました。以前の結果は履歴に保存されています。'
        : parsed.action === 'draw'
          ? '抽選を確定しました。'
          : parsed.action === 'join'
            ? mutation.changed
              ? '参加しました。'
              : 'すでに参加済みです。'
            : parsed.action === 'leave'
              ? '参加を取り消しました。'
              : '募集を取り消しました。',
    );
  } catch (error) {
    logger.error(
      { guildId, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'VALORANT募集操作に失敗',
    );
    await interaction
      .editReply('処理できませんでした。しばらくしてから再試行してください。')
      .catch(() => undefined);
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
            await handleRandom(interaction, context.prisma, context.logger);
          } else {
            await replyEphemeral(interaction, '未対応のサブコマンドです。');
          }
        },
      } as CommandHandler<ChatInputCommandInteraction>,
    ];
  },
  provideEvents(context) {
    return [
      {
        event: 'interactionCreate',
        async handler(_context, ...args) {
          const candidate = args[0] as ButtonInteraction | undefined;
          if (!candidate?.isButton?.() || !candidate.customId.startsWith(VALORANT_SESSION_PREFIX))
            return;
          await handleValorantButton(candidate, context.prisma, context.logger);
        },
      },
    ] as PluginEventHandler<ValorantPluginConfig>[];
  },
});
