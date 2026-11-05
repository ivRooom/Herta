import { createHash } from 'node:crypto';
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { listValorantAgents, type PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import {
  VALORANT_REGIONS,
  defaultValorantAgents,
  legacyValorantAgents,
  valorantRoleForAgentId,
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
import { renderValorantPicksChart } from './valorant-picks-chart.js';
import { VALORANT_META } from './valorant-meta.js';
import {
  createValorantSession,
  createDirectValorantSession,
  bindValorantVoiceChannel,
  manageValorantParticipants,
  rerollValorantSession,
  getValorantSession,
  mutateValorantSession,
  parseValorantSessionAction,
  setValorantSessionMessageId,
  VALORANT_SESSION_PREFIX,
  type ValorantCandidate,
  type ValorantAssignment,
  type ValorantSessionSnapshot,
  type ValorantSessionAction,
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

export function buildValorantSessionMessage(session: ValorantSessionSnapshot) {
  const expiryMs = session.expiresAt.getTime();
  // A corrupt or missing timestamp must not create a malformed Discord tag
  // or leave participant/reroll buttons enabled.
  const validExpiry = Number.isFinite(expiryMs) && expiryMs > 0;
  const expired = !validExpiry || expiryMs <= Date.now();
  const expiryUnix = validExpiry ? Math.floor(expiryMs / 1000) : null;
  const closed = session.status !== 'OPEN' || expired;
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
    '募集作成者：<@' + session.creatorId + '>',
    '対象VC：' +
      (session.voiceChannelId ? '<#' + session.voiceChannelId + '>' : '未設定（手動参加のみ）'),
    '参加者：' +
      members.length +
      ' / ' +
      session.maxParticipants +
      (members.length === session.maxParticipants ? '（満員）' : ''),
    ...(expiryUnix !== null && session.status === 'OPEN'
      ? ['募集期限：<t:' + expiryUnix + ':R>']
      : expiryUnix !== null && session.status === 'COMPLETED' && !expired
        ? ['再抽選期限：<t:' + expiryUnix + ':R>']
        : []),
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
      '対象パッチ：' + VALORANT_META.patchVersion,
      'メタ確認日：' + VALORANT_META.verifiedAt.replaceAll('-', '/'),
      '出典：Riot Games公式パッチノート／Herta独自編集の戦術構成',
      '統計更新日：未取得（採用率・勝率データ未使用）',
      '※構成は戦術的な候補例です。プロ大会の採用率・勝率を保証するものではありません。',
    );
    if (members.length < 5) description.push('※5人編成としては未完成です。');
  }
  description.push(
    '',
    '状態：' +
      (session.status === 'OPEN' && closed
        ? '期限切れ'
        : ({
            OPEN: '参加募集中',
            COMPLETED: '抽選完了',
            CANCELLED: '募集取消',
            EXPIRED: '期限切れ',
          }[session.status] ?? session.status)),
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
            button('reroll', '再抽選', ButtonStyle.Primary, expired),
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
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              button('vc', '🔊 VC全員参加', ButtonStyle.Secondary, closed),
              button('manage', '👥 参加者管理', ButtonStyle.Secondary, closed),
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
        ...(await buildValorantRichMessage(
          session,
          logger,
          (id) => interaction.guild?.members.cache.get(id)?.displayName,
        )),
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
      voiceChannelId:
        (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null))?.voice
          .channelId ?? null,
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

type ValorantManagedInteraction =
  | ButtonInteraction
  | UserSelectMenuInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

function isValorantManager(
  session: ValorantSessionSnapshot,
  interaction: ValorantManagedInteraction,
): boolean {
  return (
    session.creatorId === interaction.user.id ||
    Boolean(
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
    )
  );
}

function sessionCustomId(sessionId: string, action: string): string {
  return VALORANT_SESSION_PREFIX + sessionId + ':' + action;
}

function openValorantSession(session: ValorantSessionSnapshot): boolean {
  return session.status === 'OPEN' && session.expiresAt > new Date();
}

/** The GuildVoiceStates intent is enabled in bot.ts. Fetch known voice-state IDs
 * as GuildMember objects and fail closed on REST errors rather than partially adding users.
 */
async function currentValorantVoiceMembers(
  interaction: ValorantManagedInteraction,
  channelId: string,
): Promise<string[]> {
  const guild = interaction.guild;
  if (!guild) throw new Error('guild unavailable');
  const channel = await guild.channels.fetch(channelId);
  if (
    !channel ||
    !channel.isVoiceBased() ||
    (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
  ) {
    throw new Error('voice channel unavailable');
  }
  const voiceIds = [...guild.voiceStates.cache.values()]
    .filter((voice) => voice.channelId === channelId)
    .map((voice) => voice.id);
  if (voiceIds.length > 100) throw new Error('voice channel too large');
  const members = await Promise.all(voiceIds.map((id) => guild.members.fetch(id)));
  return members
    .filter((member) => !member.user.bot && member.voice.channelId === channelId)
    .map((member) => member.id)
    .sort();
}

function voiceCandidateSnapshot(session: ValorantSessionSnapshot, voiceIds: string[]) {
  const joined = session.participants.map(({ userId }) => userId).sort();
  const optedOut = [...(session.optedOutUserIds ?? [])].sort();
  const eligible = voiceIds.filter((id) => !joined.includes(id) && !optedOut.includes(id));
  const digest = createHash('sha256')
    .update(JSON.stringify([session.id, session.voiceChannelId, voiceIds, joined, optedOut]))
    .digest('hex')
    .slice(0, 12);
  return {
    eligible,
    digest,
    remaining: Math.max(0, session.maxParticipants - session.participants.length),
    optedOutCount: voiceIds.filter((id) => optedOut.includes(id)).length,
  };
}

async function updatePublicValorantRecruitment(
  interaction: ValorantManagedInteraction,
  session: ValorantSessionSnapshot,
): Promise<boolean> {
  try {
    if (!interaction.guild || !session.messageId) return false;
    const channel = await interaction.guild.channels.fetch(session.channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return false;
    const message = await channel.messages.fetch(session.messageId);
    await message.edit({ ...buildValorantSessionMessage(session), attachments: [] });
    return true;
  } catch {
    return false;
  }
}

async function showValorantManagement(
  interaction: ValorantManagedInteraction,
  session: ValorantSessionSnapshot,
): Promise<void> {
  const count = session.participants.length;
  const addMenu = new UserSelectMenuBuilder()
    .setCustomId(sessionCustomId(session.id, 'add-select'))
    .setPlaceholder('追加するサーバーメンバーを選択')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(count >= session.maxParticipants);
  const rows: Array<
    ActionRowBuilder<UserSelectMenuBuilder | StringSelectMenuBuilder | ButtonBuilder>
  > = [
    new ActionRowBuilder<
      UserSelectMenuBuilder | StringSelectMenuBuilder | ButtonBuilder
    >().addComponents(addMenu),
  ];
  if (count > 0) {
    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId(sessionCustomId(session.id, 'remove-select'))
      .setPlaceholder('除外する参加者を選択')
      .addOptions(
        session.participants.map(({ userId }, index) => ({
          label: `参加者 ${index + 1}（ID末尾 ${userId.slice(-4)}）`,
          value: userId,
        })),
      );
    rows.push(
      new ActionRowBuilder<
        UserSelectMenuBuilder | StringSelectMenuBuilder | ButtonBuilder
      >().addComponents(removeMenu),
    );
  }
  rows.push(
    new ActionRowBuilder<
      UserSelectMenuBuilder | StringSelectMenuBuilder | ButtonBuilder
    >().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionCustomId(session.id, 'vc'))
        .setLabel('🔊 VC再取得')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(sessionCustomId(session.id, 'close'))
        .setLabel('キャンセル・閉じる')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  await interaction.editReply({
    content: [
      '👥 **参加者管理（募集作成者・管理者専用）**',
      `参加者：${count} / ${session.maxParticipants}`,
      count
        ? session.participants.map(({ userId }) => '<@' + userId + '>').join('、')
        : '現在の参加者はいません。',
      '追加・除外するメンバーを1人選び、次の画面で確定してください。',
    ].join('\n'),
    components: rows,
    allowedMentions: { parse: [] },
  });
}

async function showValorantVoicePreview(
  interaction: ValorantManagedInteraction,
  session: ValorantSessionSnapshot,
): Promise<void> {
  if (!session.voiceChannelId) {
    await interaction.editReply({
      content:
        '対象VCが未設定です。対象とするボイスチャンネルを選んでください。選択後に確定すると、その募集では変更できません。',
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(sessionCustomId(session.id, 'select-vc'))
            .setPlaceholder('対象VCを明示的に選択')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
      ],
    });
    return;
  }
  const ids = await currentValorantVoiceMembers(interaction, session.voiceChannelId);
  const snapshot = voiceCandidateSnapshot(session, ids);
  const content = [
    `🔊 **対象VC：<#${session.voiceChannelId}>**`,
    `VCの人間ユーザー：${ids.length}名 / 新規追加候補：${snapshot.eligible.length}名`,
    `空き枠：${snapshot.remaining}名`,
    snapshot.optedOutCount
      ? `本人が参加取消した${snapshot.optedOutCount}名は一括追加から除外します。`
      : '',
    snapshot.eligible
      .slice(0, 20)
      .map((id) => '<@' + id + '>')
      .join('、') || '追加対象はありません。',
    snapshot.eligible.length > 20 ? '（表示は先頭20名。参加者を選んでください）' : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (snapshot.eligible.length === 0 || snapshot.remaining === 0) {
    await interaction.editReply({
      content: content + '\n現在、一括追加できるメンバーはいません。',
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const action =
    snapshot.eligible.length <= snapshot.remaining
      ? 'vc-commit-' + snapshot.digest
      : 'vc-choose-' + snapshot.digest;
  const components =
    snapshot.eligible.length <= snapshot.remaining
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, action))
              .setLabel('表示した候補を追加確定')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, 'close'))
              .setLabel('キャンセル')
              .setStyle(ButtonStyle.Secondary),
          ),
        ]
      : [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(sessionCustomId(session.id, action))
              .setPlaceholder('追加候補を選択（次の画面で確認・確定）')
              .setMinValues(1)
              .setMaxValues(Math.min(snapshot.remaining, 5)),
          ),
        ];
  await interaction.editReply({
    content:
      content +
      (snapshot.eligible.length > snapshot.remaining
        ? '\n**定員超過：無作為追加は行いません。選択したメンバーのみ登録します。**'
        : '\n内容を確認して追加を確定してください。'),
    components,
    allowedMentions: { parse: [] },
  });
}

async function handleValorantManagement(
  interaction: ValorantManagedInteraction,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  const parsed = parseValorantSessionAction(interaction.customId);
  if (!parsed || !interaction.guildId || !interaction.channelId) return;
  // Keep all subsequent management steps in a single ephemeral UI, so an
  // old selection menu does not remain actionable beside a newer confirmation.
  // The original public recruitment button still receives an ephemeral reply.
  if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const guildId = interaction.guildId;
  try {
    const session = await getValorantSession(prisma, guildId, parsed.id);
    if (
      !session ||
      session.channelId !== interaction.channelId ||
      (session.messageId &&
        interaction.message.id !== session.messageId &&
        !interaction.message.flags.has(MessageFlags.Ephemeral))
    ) {
      await interaction.editReply('対象の募集が見つかりません。');
      return;
    }
    if (!isValorantManager(session, interaction)) {
      await interaction.editReply(
        '参加者の一括追加・管理は募集作成者またはサーバー管理者のみ可能です。',
      );
      return;
    }
    if (!openValorantSession(session)) {
      await interaction.editReply('募集は終了済み、または期限切れのため編集できません。');
      return;
    }
    const action = parsed.action;
    if (action === 'close') {
      await interaction.editReply({
        content: '操作をキャンセルしました。参加者は変更されていません。',
        components: [],
      });
      return;
    }
    if (action === 'manage') {
      await showValorantManagement(interaction, session);
      return;
    }
    if (action === 'vc') {
      await showValorantVoicePreview(interaction, session);
      return;
    }
    if (action === 'select-vc' && interaction.isChannelSelectMenu()) {
      const channelId = interaction.values[0];
      const channel = channelId ? await interaction.guild?.channels.fetch(channelId) : null;
      if (
        !channel ||
        !channel.isVoiceBased() ||
        (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
      ) {
        await interaction.editReply('このサーバーのボイスチャンネルを選択してください。');
        return;
      }
      await interaction.editReply({
        content: `<#${channel.id}> を対象VCとして固定します。後から自動で切り替えることはありません。`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, 'vc-bind-' + channel.id))
              .setLabel('対象VCを確定')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, 'close'))
              .setLabel('キャンセル')
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (action.startsWith('vc-bind-') && interaction.isButton()) {
      const channelId = action.slice('vc-bind-'.length);
      const channel = await interaction.guild?.channels.fetch(channelId);
      if (
        !channel ||
        !channel.isVoiceBased() ||
        (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
      ) {
        await interaction.editReply('対象VCが見つからないため確定できません。');
        return;
      }
      const updated = await bindValorantVoiceChannel(prisma, {
        guildId,
        id: session.id,
        userId: interaction.user.id,
        isAdmin: isValorantManager(session, interaction),
        channelId,
      });
      if (updated.status !== 'ok') {
        await interaction.editReply(
          updated.status === 'voice_changed'
            ? '対象VCはすでに別のチャンネルで固定されています。'
            : '対象VCを確定できませんでした。募集状態を確認してください。',
        );
        return;
      }
      const synced =
        !updated.changed || (await updatePublicValorantRecruitment(interaction, updated.session));
      await interaction.editReply({
        content: synced
          ? '対象VCを固定しました。VC全員参加ボタンから候補を確認できます。'
          : '対象VCはDBに保存されましたが、募集Embedの更新に失敗しました。',
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, 'vc'))
              .setLabel('VCメンバーを確認')
              .setStyle(ButtonStyle.Primary),
          ),
        ],
      });
      return;
    }
    if (
      (action === 'add-select' && interaction.isUserSelectMenu()) ||
      (action === 'remove-select' && interaction.isStringSelectMenu())
    ) {
      const userId = interaction.values[0];
      if (!userId || !/^[0-9]{17,20}$/.test(userId)) {
        await interaction.editReply('選択したメンバーを確認できません。');
        return;
      }
      const removing = action === 'remove-select';
      if (removing && !session.participants.some(({ userId: id }) => id === userId)) {
        await interaction.editReply('選択したメンバーはすでに参加者ではありません。');
        return;
      }
      if (!removing) {
        const member = await interaction.guild?.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) {
          await interaction.editReply('追加できるのは、このサーバーの人間ユーザーだけです。');
          return;
        }
      }
      await interaction.editReply({
        content: `<@${userId}> を${removing ? '参加者から除外' : '参加者に追加'}します。確定しますか？`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, (removing ? 'remove-' : 'add-') + userId))
              .setLabel(removing ? '除外を確定' : '追加を確定')
              .setStyle(removing ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(sessionCustomId(session.id, 'close'))
              .setLabel('キャンセル')
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    let mutation;
    if (
      action.startsWith('vc-commit-') ||
      action.startsWith('vc-choose-') ||
      action.startsWith('vc-stage-')
    ) {
      if (!session.voiceChannelId) {
        await interaction.editReply('対象VCが設定されていません。');
        return;
      }
      const isChoosing = action.startsWith('vc-choose-');
      const isStaged = action.startsWith('vc-stage-');
      if (
        (isChoosing && !interaction.isUserSelectMenu()) ||
        (!isChoosing && !interaction.isButton())
      ) {
        await interaction.editReply('操作形式が不正です。');
        return;
      }
      const voiceIds = await currentValorantVoiceMembers(interaction, session.voiceChannelId);
      const snapshot = voiceCandidateSnapshot(session, voiceIds);
      const expectedDigest = isChoosing
        ? action.slice('vc-choose-'.length)
        : isStaged
          ? action.slice('vc-stage-'.length, 'vc-stage-'.length + 12)
          : action.slice('vc-commit-'.length);
      if (snapshot.digest !== expectedDigest) {
        await interaction.editReply(
          'VCまたは参加者が変更されました。VC全員参加から候補を再取得してください。',
        );
        return;
      }

      let selected: string[];
      if (isChoosing && interaction.isUserSelectMenu()) {
        selected = interaction.values;
      } else if (isStaged) {
        // The selected positions are stateless and tied to the hashed VC snapshot,
        // so no process-local state survives a Bot restart or permits stale commits.
        const encoded = action.slice('vc-stage-'.length + 13).split('.');
        const indices = encoded.map((value) => Number.parseInt(value, 36));
        if (
          encoded.some(
            (value, index) =>
              !/^[0-9a-z]{1,2}$/.test(value) || indices[index]?.toString(36) !== value,
          ) ||
          new Set(indices).size !== indices.length
        ) {
          await interaction.editReply('選択したメンバーの確認情報が正しくありません。');
          return;
        }
        selected = indices.map((index) => snapshot.eligible[index] ?? '');
      } else {
        selected = snapshot.eligible;
      }

      if (
        !selected.length ||
        selected.length > snapshot.remaining ||
        new Set(selected).size !== selected.length ||
        (isChoosing && snapshot.eligible.length <= snapshot.remaining) ||
        selected.some((id) => !snapshot.eligible.includes(id))
      ) {
        await interaction.editReply(
          '選択内容が対象VCや参加枠と一致しません。もう一度やり直してください。',
        );
        return;
      }

      if (isChoosing) {
        // A Select Menu alone must NEVER write participants to the database.
        // At most 5 indices in a <=100 member VC fit in a <=100-char Discord customId.
        const positions = selected.map((id) => snapshot.eligible.indexOf(id).toString(36));
        await interaction.editReply({
          content: [
            '🔊 **VC一括参加の最終確認**',
            '追加対象：' + selected.map((id) => '<@' + id + '>').join('、'),
            `追加後：${session.participants.length + selected.length} / ${session.maxParticipants}名`,
            '「選択メンバーを追加確定」を押すまで参加者は変更されません。',
          ].join('\n'),
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  sessionCustomId(
                    session.id,
                    'vc-stage-' + snapshot.digest + '-' + positions.join('.'),
                  ),
                )
                .setLabel('選択メンバーを追加確定')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(sessionCustomId(session.id, 'close'))
                .setLabel('キャンセル')
                .setStyle(ButtonStyle.Secondary),
            ),
          ],
          allowedMentions: { parse: [] },
        });
        return;
      }

      mutation = await manageValorantParticipants(prisma, {
        guildId,
        id: session.id,
        userId: interaction.user.id,
        isAdmin: true,
        action: 'bulk',
        targetIds: selected,
        expectedVoiceChannelId: session.voiceChannelId,
      });
    } else if (
      (action.startsWith('add-') || action.startsWith('remove-')) &&
      interaction.isButton()
    ) {
      const removing = action.startsWith('remove-');
      const userId = action.slice(removing ? 'remove-'.length : 'add-'.length);
      if (!removing) {
        const member = await interaction.guild?.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) {
          await interaction.editReply('追加できるのは、このサーバーの人間ユーザーだけです。');
          return;
        }
      }
      mutation = await manageValorantParticipants(prisma, {
        guildId,
        id: session.id,
        userId: interaction.user.id,
        isAdmin: true,
        action: removing ? 'remove' : 'add',
        targetIds: [userId],
      });
    } else {
      await interaction.editReply('未対応の参加者管理操作です。');
      return;
    }

    if (mutation.status !== 'ok') {
      const errors: Record<string, string> = {
        missing: '募集が見つかりません。',
        closed: '募集は終了済み、または期限切れです。',
        forbidden: '参加者を変更する権限がありません。',
        full: '定員を超えるため登録しませんでした。参加者管理から追加対象を選び直してください。',
        not_joined: '対象メンバーは参加していません。',
        voice_changed: '対象VCが変更されたため登録を中止しました。',
        invalid: '参加者の指定内容が正しくありません。',
      };
      await interaction.editReply(errors[mutation.status] ?? '参加者を変更できませんでした。');
      return;
    }
    const synced =
      !mutation.changed || (await updatePublicValorantRecruitment(interaction, mutation.session));
    await interaction.editReply({
      content: synced
        ? mutation.changed
          ? `参加者を更新しました（${mutation.session.participants.length} / ${mutation.session.maxParticipants}名）。`
          : 'すでに反映済みのため、参加者の変更はありません。'
        : '参加者の変更はDBへ保存されましたが、募集Embedの更新に失敗しました。',
      components: [],
    });
  } catch (error) {
    logger.error(
      { guildId, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'VALORANT参加者管理に失敗',
    );
    await interaction
      .editReply(
        'VCの取得または参加者管理に失敗しました。権限やVC状態を確認して再試行してください。',
      )
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
            action: parsed.action as ValorantSessionAction,
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

/** Guild-scoped Herta pick statistics, intentionally separate from HenrikDev rank. */
async function handlePickStatistics(
  interaction: ChatInputCommandInteraction,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  const scope = interaction.options.getString('scope') ?? 'self';
  if (scope !== 'self' && scope !== 'guild') {
    await replyEphemeral(interaction, '集計対象が不正です。');
    return;
  }
  const authorized =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
  if (scope === 'guild' && !authorized) {
    await replyEphemeral(interaction, 'サーバー全体の集計は管理権限が必要です。');
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const rows = await prisma.valorantPickSession.findMany({
      where: { guildId: interaction.guildId!, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 5001,
      select: { result: true },
    });
    const agents = new Map<string, number>();
    const roles = new Map<string, number>();
    let draws = 0;
    for (const row of rows.slice(0, 5000)) {
      const results = Array.isArray(row.result) ? row.result : [];
      let included = false;
      for (const item of results) {
        if (
          typeof item !== 'object' ||
          item === null ||
          Array.isArray(item) ||
          typeof item.agentId !== 'string' ||
          (scope === 'self' && item.userId !== interaction.user.id)
        ) {
          continue;
        }
        included = true;
        const agentId = item.agentId;
        const role = valorantRoleForAgentId(agentId);
        agents.set(agentId, (agents.get(agentId) ?? 0) + 1);
        roles.set(role, (roles.get(role) ?? 0) + 1);
      }
      if (included) draws++;
    }
    const labels = new Map(
      defaultValorantAgents().map((agent) => [agent.agentId, agent.displayName]),
    );
    const show = (items: Map<string, number>, names?: ReadonlyMap<string, string>) =>
      [...items.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([name, count]) => `${names?.get(name) ?? name}: ${count}回`)
        .join(' / ') || '記録なし';
    const roleNames = new Map([
      ['DUELIST', 'デュエリスト'],
      ['CONTROLLER', 'コントローラー'],
      ['INITIATOR', 'イニシエーター'],
      ['SENTINEL', 'センチネル'],
      ['UNKNOWN', '未分類'],
    ]);
    const title = scope === 'guild' ? 'Guild全体' : 'あなた本人';
    // Render only the authorized aggregate counts; no identifiers or raw sessions.
    let files: AttachmentBuilder[] = [];
    try {
      const sorted = (items: Map<string, number>, names: ReadonlyMap<string, string>) =>
        [...items.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([name, count]) => ({ label: names.get(name) ?? name, count }));
      const image = await renderValorantPicksChart({
        scopeLabel: title,
        draws,
        truncated: rows.length > 5000,
        agents: sorted(agents, labels),
        roles: sorted(roles, roleNames),
      });
      files = [new AttachmentBuilder(image, { name: 'valorant-picks-chart.png' })];
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'VALORANT抽選グラフ生成失敗、テキストにフォールバック',
      );
    }
    await interaction.editReply({
      content:
        `🎮 Hertaの抽選統計（${title}）\n` +
        `対象抽選: ${draws}件（最新5,000件内）\n` +
        `Agent別: ${show(agents, labels)}\n` +
        `Role別: ${show(roles, roleNames)}\n` +
        (rows.length > 5000 ? '※履歴を最新5,000件に制限しています。\n' : '') +
        '※勝率ではなく選出回数です。個人IDは90日で匿名化されます。結果は非公開です。',
      files,
      allowedMentions: { parse: [] },
    });
  } catch {
    await interaction.editReply({
      content: '抽選統計を取得できません。しばらくしてから再度お試しください。',
    });
  }
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
          } else if (subcommand === 'picks') {
            await handlePickStatistics(interaction, context.prisma, context.logger);
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
          const candidate = args[0] as ValorantManagedInteraction | undefined;
          if (!candidate?.customId?.startsWith(VALORANT_SESSION_PREFIX)) return;
          const parsed = parseValorantSessionAction(candidate.customId);
          if (!parsed) return;
          if (
            candidate.isButton() &&
            ['join', 'leave', 'draw', 'cancel', 'reroll'].includes(parsed.action)
          ) {
            await handleValorantButton(candidate, context.prisma, context.logger);
          } else if (
            candidate.isButton() ||
            candidate.isUserSelectMenu() ||
            candidate.isStringSelectMenu() ||
            candidate.isChannelSelectMenu()
          ) {
            await handleValorantManagement(candidate, context.prisma, context.logger);
          }
        },
      },
    ] as PluginEventHandler<ValorantPluginConfig>[];
  },
});
