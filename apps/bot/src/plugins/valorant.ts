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
  toggleValorantSessionTrollOff,
  attachValorantSessionTrollResult,
  findOpenValorantAutoJoinSessions,
  autoJoinValorantSession,
  VALORANT_SESSION_PREFIX,
  type ValorantCandidate,
  type ValorantAssignment,
  type ValorantSessionSnapshot,
  type ValorantSessionAction,
} from './valorant-session-repository.js';
import {
  drawValorantTrolls,
  formatValorantTrollCardText,
  formatValorantTrollEmbedText,
  mergeValorantTrollsIntoResult,
  normalizeValorantTrollConfig,
  readValorantTrollFromEntry,
  resolveValorantTrollApiConfig,
  type ValorantTrollConfig,
} from './valorant-troll-gacha.js';
import {
  abortValorantWerewolfGame,
  castValorantWerewolfVote,
  getValorantWerewolfRevealed,
  getValorantWerewolfSecretForUser,
  getValorantWerewolfState,
  getValorantWerewolfVoteProgress,
  markValorantWerewolfSecretViewed,
  openValorantWerewolfVote,
  parseWerewolfRoster,
  type WerewolfGameRow,
} from './valorant-werewolf-repository.js';
import {
  closeValorantWerewolfRoundAndSettle,
  retryValorantWerewolfPunishment,
  startValorantWerewolf,
} from './valorant-werewolf-service.js';
import { buildWerewolfPublicView, type WerewolfRevealedLike } from './valorant-werewolf-api.js';
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
  /** トロールガチャ (縛り) 合流の設定 (#1047)。既定は無効 */
  trollGacha: ValorantTrollConfig;
  /** 人狼モード (#1049) の有効化。通常合流とは独立。既定は無効 */
  werewolfEnabled: boolean;
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
    trollGacha: normalizeValorantTrollConfig(source),
    werewolfEnabled: source['trollWerewolfEnabled'] === true,
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

export function buildValorantSessionMessage(
  session: ValorantSessionSnapshot,
  options: { trollGachaEnabled?: boolean } = {},
) {
  // 人狼部屋 (#1049) は専用ビルダーへ委譲する。game を持たない呼び出し
  // (募集同期・管理フロー) では募集中/終了の殻だけを描く。
  if (session.mode === 'WEREWOLF') return buildValorantWerewolfMessage(session, null);
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
      ? assignments.map((item) => {
          const base = '<@' + item.userId + '> — **' + escapeMarkdown(item.displayName) + '**';
          const troll = readValorantTrollFromEntry(item);
          return troll
            ? base + '\n　└ ' + escapeMarkdown(formatValorantTrollEmbedText(troll))
            : base;
        })
      : members.map((id) => '👤 <@' + id + '>');
  const description = [
    'モード：' + (session.mode === 'TACTICAL' ? '実戦向け構成' : '完全ランダム'),
    'マップ：' + japaneseValorantMap(session.mapId),
    '募集作成者：<@' + session.creatorId + '>',
    '対象VC：' +
      (session.voiceChannelId
        ? '<#' + session.voiceChannelId + '>'
        : session.vcAutoJoin
          ? '未設定（VCを固定すると自動参加が有効になります）'
          : '未設定（手動参加のみ）'),
    ...(session.status === 'OPEN' && session.vcAutoJoin
      ? ['VC自動参加：ON（対象VCに入ると自動で参加登録されます。退出しても参加は維持されます）']
      : []),
    '参加者：' +
      members.length +
      ' / ' +
      session.maxParticipants +
      (members.length === session.maxParticipants ? '（満員）' : ''),
    ...(session.status === 'OPEN' && (session.trollOffUserIds ?? []).length > 0
      ? [
          '縛りオフ：' +
            (session.trollOffUserIds ?? []).map((id) => '<@' + id + '>').join('、') +
            '（縛りの対象外）',
        ]
      : []),
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
              ...(options.trollGachaEnabled
                ? [button('troll-off', '🎭 縛りオフ切替', ButtonStyle.Secondary, closed)]
                : []),
            ),
          ]
        : [];
  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] as [] },
  };
}

/**
 * 人狼部屋 (#1049) の公開メッセージ。
 *
 * 秘匿の境界: RESOLVED より前は秘密テーブル由来の情報を一切含めない
 * (人狼 ID は roster の一員として並ぶだけで、役割は示さない)。
 * revealed は結果確定後に呼び出し側が渡したときだけ描く。
 * game が null のときは pick session の殻だけから描く (募集中・中止)。
 */
function buildValorantWerewolfMessage(
  session: ValorantSessionSnapshot,
  game: WerewolfGameRow | null,
  options: { votedCount?: number; revealed?: WerewolfRevealedLike | null } = {},
) {
  const button = (action: string, label: string, style: ButtonStyle, disabled = false) =>
    new ButtonBuilder()
      .setCustomId(VALORANT_SESSION_PREFIX + session.id + ':' + action)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  const roster = game
    ? parseWerewolfRoster(game.rosterSnapshot)
    : session.participants.map((participant, index) => ({
        userId: participant.userId,
        displayName: `参加者${index + 1}`,
      }));
  const memberLines = roster.length
    ? roster.map((entry) => '👤 <@' + entry.userId + '>').join('\n')
    : '参加者はいません';
  const base = [
    'モード：人狼（秘密の縛り＋投票）',
    '募集作成者：<@' + session.creatorId + '>',
    '対象VC：' +
      (session.voiceChannelId
        ? '<#' + session.voiceChannelId + '>'
        : session.vcAutoJoin
          ? '未設定（VCを固定すると自動参加が有効になります）'
          : '未設定（手動参加のみ）'),
  ];
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🐺 VALORANT 人狼モード');
  let components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (!game) {
    const expired = session.expiresAt.getTime() <= Date.now();
    const open = session.status === 'OPEN' && !expired;
    const expiryUnix = Math.floor(session.expiresAt.getTime() / 1000);
    embed.setDescription(
      [
        ...base,
        ...(session.status === 'OPEN' && session.vcAutoJoin
          ? ['VC自動参加：ON（対象VCに入ると自動で参加登録されます。退出しても参加は維持されます）']
          : []),
        '参加者：' +
          roster.length +
          ' / ' +
          session.maxParticipants +
          (roster.length >= session.maxParticipants ? '（満員）' : ''),
        ...(session.status === 'OPEN' ? ['募集期限：<t:' + expiryUnix + ':R>'] : []),
        '',
        memberLines,
        '',
        '状態：' +
          (session.status === 'CANCELLED'
            ? '中止（秘密は公開されません）'
            : session.status === 'COMPLETED'
              ? '終了'
              : open
                ? '参加募集中（開始には3人以上が必要です）'
                : '期限切れ'),
      ].join('\n'),
    );
    if (open) {
      components = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button('join', '参加', ButtonStyle.Success, roster.length >= session.maxParticipants),
          button('leave', '参加取消', ButtonStyle.Secondary),
          button('wolf-start', '🐺 開始', ButtonStyle.Primary, roster.length < 3),
          button('wolf-cancel', '中止', ButtonStyle.Danger),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button('vc', '🔊 VC全員参加', ButtonStyle.Secondary),
          button('manage', '👥 参加者管理', ButtonStyle.Secondary),
        ),
      ];
    }
    return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
  }

  const view = buildWerewolfPublicView(session, game, {
    votedCount: options.votedCount ?? 0,
    revealed: options.revealed ?? null,
  });
  const phase = game.phase;
  if (phase === 'ASSIGNING') {
    embed.setDescription(
      [
        ...base,
        '',
        memberLines,
        '',
        game.assignmentStatus === 'READY'
          ? '状態：開始処理中'
          : '状態：開始処理中（縛りの抽選が完了していません。「開始リトライ」で再開できます）',
      ].join('\n'),
    );
    components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('wolf-start', '開始リトライ', ButtonStyle.Primary),
        button('wolf-cancel', '中止', ButtonStyle.Danger),
      ),
    ];
  } else if (phase === 'PLAYING') {
    embed.setDescription(
      [
        ...base,
        '',
        memberLines,
        '',
        '参加者のうち1人だけが秘密の縛りを持っています。',
        '自分の縛りは「自分の縛りを確認」ボタンで本人だけが確認できます。',
        '状態：試合中',
      ].join('\n'),
    );
    components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('wolf-secret', '🎭 自分の縛りを確認', ButtonStyle.Secondary),
        button('wolf-vote-open', '🗳 投票へ進む', ButtonStyle.Primary),
        button('wolf-cancel', '中止', ButtonStyle.Danger),
      ),
    ];
  } else if (phase === 'VOTING' || phase === 'RUNOFF') {
    const candidates =
      phase === 'RUNOFF'
        ? roster.filter((entry) => game.currentCandidateUserIds.includes(entry.userId))
        : roster;
    const endsUnix = game.voteEndsAt ? Math.floor(game.voteEndsAt.getTime() / 1000) : null;
    embed.setDescription(
      [
        ...base,
        '',
        phase === 'RUNOFF' ? '決選投票の候補者：' : '参加者：',
        candidates.map((entry) => '👤 <@' + entry.userId + '>').join('\n'),
        '',
        '投票済み：' + (options.votedCount ?? 0) + ' / ' + roster.length,
        ...(endsUnix !== null ? ['締切目安：<t:' + endsUnix + ':R>'] : []),
        '状態：' +
          (phase === 'RUNOFF' ? '決選投票中' : '投票中') +
          '（票数は締切まで公開されません）',
      ].join('\n'),
    );
    components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('wolf-vote', '🗳 投票する', ButtonStyle.Primary),
        button('wolf-close', '締切', ButtonStyle.Secondary),
        button('wolf-cancel', '中止', ButtonStyle.Danger),
      ),
    ];
  } else if (phase === 'RESOLVING') {
    embed.setDescription([...base, '', memberLines, '', '状態：結果を集計しています'].join('\n'));
  } else if (phase === 'RESOLVED' && view.result) {
    const result = view.result;
    const nameOf = (userId: string | null) => (userId ? '<@' + userId + '>' : '（指名なし）');
    const roundLines = result.rounds.map((round) => {
      const tallyText = Object.entries(round.tally)
        .map(([userId, count]) => '<@' + userId + '>：' + count + '票')
        .join('、');
      return (round.round === 1 ? '本投票' : '決選投票') + ' — ' + (tallyText || '投票なし');
    });
    embed.setDescription(
      [
        ...base,
        '',
        result.outcome === 'CITIZENS_WIN' ? '🎉 **市民の勝利**' : '🐺 **人狼の勝利**',
        '指名者：' + nameOf(result.accusedUserId),
        '人狼：' + nameOf(result.werewolfUserId),
        result.revealedTroll
          ? '秘密の縛り：' + formatValorantTrollEmbedText(result.revealedTroll)
          : '秘密の縛り：（記録なし）',
        '',
        ...roundLines,
        '',
        result.punishment
          ? '罰ゲーム：' +
            nameOf(result.punishment.userId) +
            ' — ' +
            formatValorantTrollEmbedText(result.punishment.troll)
          : result.punishmentStatus === 'UNAVAILABLE'
            ? '罰ゲーム：抽選できませんでした（対象者への再試行が可能です）'
            : '罰ゲーム：なし',
        '',
        '状態：結果確定',
      ].join('\n'),
    );
    if (result.punishmentStatus === 'UNAVAILABLE' && game.punishmentUserId) {
      components = [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button('wolf-punishment-retry', '罰ゲームを引き直す', ButtonStyle.Secondary),
        ),
      ];
    }
  } else if (phase === 'ABORTED') {
    embed.setDescription(
      [
        ...base,
        '',
        memberLines,
        '',
        game.outcomeReason === 'NO_VOTES'
          ? '状態：投票がなかったため中止しました（秘密は公開されません）'
          : '状態：中止しました（秘密は公開されません）',
      ].join('\n'),
    );
  } else {
    embed.setDescription([...base, '', memberLines, '', '状態：' + phase].join('\n'));
  }
  embed.setTimestamp(session.completedAt ?? session.createdAt);
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}

/** DB 正本から人狼部屋の公開メッセージ payload を組み立てる */
async function buildWerewolfMessageForState(
  prisma: PrismaClient,
  session: ValorantSessionSnapshot,
): Promise<ReturnType<typeof buildValorantWerewolfMessage>> {
  const state = await getValorantWerewolfState(prisma, session.guildId, session.id);
  const game = state?.game ?? null;
  let votedCount = 0;
  if (game && (game.phase === 'VOTING' || game.phase === 'RUNOFF')) {
    const progress = await getValorantWerewolfVoteProgress(prisma, session.guildId, session.id);
    votedCount = progress?.votedCount ?? 0;
  }
  const revealed =
    game && game.phase === 'RESOLVED'
      ? await getValorantWerewolfRevealed(prisma, session.guildId, session.id)
      : null;
  return buildValorantWerewolfMessage(session, game, { votedCount, revealed });
}

export async function buildValorantRichMessage(
  session: ValorantSessionSnapshot,
  logger: Logger,
  displayName?: (userId: string) => string | undefined,
  options: { trollGachaEnabled?: boolean } = {},
) {
  const basic = buildValorantSessionMessage(session, options);
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
      entries: assignments.map((entry, index) => {
        const troll = readValorantTrollFromEntry(entry);
        return {
          agentName: entry.agentName,
          displayName: entry.displayName,
          playerLabel: displayName?.(entry.userId) ?? `PLAYER ${index + 1}`,
          trollText: troll ? formatValorantTrollCardText(troll) : null,
        };
      }),
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

/**
 * 抽選確定直後に縛り (トロール) を合流させる (#1047)。
 *
 * Guild 設定で無効、または Bot API の env (IVRM_WEB_API_BASE_URL /
 * HERTA_TROLL_BOT_SECRET) が未設定なら何もしない。API が失敗しても
 * 例外を投げず、縛りなしのセッションをそのまま返す (fail-soft)。
 * 成功時は result JSON へ合流して DB へ保存し、後からの表示再構築
 * でも同じ縛りが見えるようにする。判定は ivrm-web 側 (S1) のみで、
 * ここでは二重抽選しない。
 */
export async function applyValorantTrollsToSession(
  prisma: PrismaClient,
  logger: Logger,
  session: ValorantSessionSnapshot,
  input: {
    operatorId: string;
    config: ValorantPluginConfig;
    displayName?: (userId: string) => string | undefined;
  },
): Promise<ValorantSessionSnapshot> {
  if (!input.config.trollGacha.enabled) return session;
  if (session.status !== 'COMPLETED' || !Array.isArray(session.result)) return session;
  const api = resolveValorantTrollApiConfig(process.env);
  if (!api) return session;
  const entries = session.result.filter(
    (item): item is { userId: string } =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as { userId?: unknown }).userId === 'string',
  );
  if (entries.length === 0 || entries.length > 5) return session;
  const participantIds = new Set(entries.map((entry) => entry.userId));
  const drawn = await drawValorantTrolls(api, {
    operatorDiscordUserId: input.operatorId,
    guildId: session.guildId,
    sessionId: session.id,
    participants: entries.map((entry, index) => ({
      discordUserId: entry.userId,
      name: input.displayName?.(entry.userId) ?? `参加者${index + 1}`,
    })),
    trollOffDiscordUserIds: (session.trollOffUserIds ?? []).filter((id) => participantIds.has(id)),
    config: input.config.trollGacha,
  });
  if (drawn.status !== 'ok') {
    logger.warn(
      {
        guildId: session.guildId,
        sessionId: session.id,
        httpStatus: drawn.httpStatus,
        code: drawn.code,
      },
      'VALORANT縛り抽選に失敗、縛りなしで抽選結果を表示',
    );
    return session;
  }
  const merged = mergeValorantTrollsIntoResult(session.result, drawn.trollByUserId);
  if (!merged) return session;
  const persisted = await attachValorantSessionTrollResult(prisma, {
    guildId: session.guildId,
    id: session.id,
    result: merged,
  }).catch(() => false);
  if (!persisted) {
    logger.warn(
      { guildId: session.guildId, sessionId: session.id },
      'VALORANT縛り結果の保存に失敗、表示のみ合流',
    );
  }
  return { ...session, result: merged } as ValorantSessionSnapshot;
}

export function pickValorantAssignments(
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

export async function getActiveValorantCandidates(
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
    // VC自動参加 (#1048) は募集型のみの opt-in。@指定の即時抽選には影響しない。
    const vcAutoJoin = interaction.options.getBoolean('vc_auto_join') === true;
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
      const displaySession = await applyValorantTrollsToSession(prisma, logger, session, {
        operatorId: interaction.user.id,
        config,
        displayName: (id) => interaction.guild?.members.cache.get(id)?.displayName,
      });
      await interaction.editReply(
        '指定メンバーの抽選が完了しました。結果の「再抽選」ボタンで引き直せます。',
      );
      const message = await interaction.followUp({
        ...(await buildValorantRichMessage(
          displaySession,
          logger,
          (id) => interaction.guild?.members.cache.get(id)?.displayName,
          { trollGachaEnabled: config.trollGacha.enabled },
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
      vcAutoJoin,
      maxParticipants: config.maxParticipants,
      expiresAt,
      rulesVersion,
    });
    await interaction.editReply(
      vcAutoJoin
        ? '参加募集を作成しました。対象VCに入室した人は自動で参加登録されます（参加ボタンでも参加できます）。'
        : '参加募集を作成しました。参加ボタンを押した人だけが抽選対象です。',
    );
    const message = await interaction.followUp({
      ...buildValorantSessionMessage(session, { trollGachaEnabled: config.trollGacha.enabled }),
      flags: [],
    });
    await setValorantSessionMessageId(prisma, interaction.guildId, session.id, message.id);
    if (vcAutoJoin) {
      // A member who enters the pinned VC between session creation and the
      // message ID being stored is auto-registered, but that registration
      // cannot refresh the post (messageId was still null) and this handler
      // has just posted its pre-registration snapshot. Reload the session
      // and refresh the initial post when a registration landed in that
      // window; a later re-entry reports changed=false and would never
      // repair the display. Fail-soft: the DB stays the source of truth.
      let reloaded: ValorantSessionSnapshot | null = null;
      try {
        reloaded = await getValorantSession(prisma, interaction.guildId, session.id);
      } catch {
        reloaded = null;
      }
      if (
        reloaded &&
        reloaded.participants.some(
          ({ userId }) => !session.participants.some((entry) => entry.userId === userId),
        )
      ) {
        await syncValorantRecruitmentFromClient(interaction.client, prisma, logger, reloaded);
      }
    }
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

/**
 * 人狼モード (#1049) の部屋作成。通常抽選と lifecycle が異なるため
 * サブコマンドを分ける。募集・参加者・VC自動参加は既存基盤をそのまま
 * 使い、開始時に mode='WEREWOLF' のまま IN_PROGRESS へ進む。
 */
async function handleWerewolf(
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
    if (!config.werewolfEnabled) {
      await interaction.editReply('人狼モードは現在無効です。');
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
    const vcAutoJoin = interaction.options.getBoolean('vc_auto_join') === true;
    const expiresAt = new Date(Date.now() + config.sessionDurationMinutes * 60_000);
    const session = await createValorantSession(prisma, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      creatorId: interaction.user.id,
      mode: 'WEREWOLF',
      mapId: null,
      voiceChannelId:
        (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null))?.voice
          .channelId ?? null,
      vcAutoJoin,
      maxParticipants: config.maxParticipants,
      expiresAt,
      rulesVersion: 'werewolf-v1',
    });
    await interaction.editReply(
      vcAutoJoin
        ? '人狼モードの部屋を作成しました。対象VCに入室した人は自動で参加登録されます（参加ボタンでも参加できます）。開始には3人以上が必要です。'
        : '人狼モードの部屋を作成しました。開始には3人以上が必要です。',
    );
    const message = await interaction.followUp({
      ...buildValorantSessionMessage(session),
      flags: [],
    });
    await setValorantSessionMessageId(prisma, interaction.guildId, session.id, message.id);
    if (vcAutoJoin) {
      // handleRandom と同じ競合対策: messageId 保存前に自動登録された
      // メンバーがいたら初期投稿を最新化する (fail-soft)。
      let reloaded: ValorantSessionSnapshot | null = null;
      try {
        reloaded = await getValorantSession(prisma, interaction.guildId, session.id);
      } catch {
        reloaded = null;
      }
      if (
        reloaded &&
        reloaded.participants.some(
          ({ userId }) => !session.participants.some((entry) => entry.userId === userId),
        )
      ) {
        await syncValorantRecruitmentFromClient(interaction.client, prisma, logger, reloaded);
      }
    }
  } catch (error) {
    logger.error(
      {
        guildId: interaction.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'VALORANT人狼部屋の作成に失敗',
    );
    await interaction
      .editReply('部屋の作成に失敗しました。DiscordまたはDBを確認してください。')
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
  trollGachaEnabled = false,
): Promise<boolean> {
  try {
    if (!interaction.guild || !session.messageId) return false;
    const channel = await interaction.guild.channels.fetch(session.channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return false;
    const message = await channel.messages.fetch(session.messageId);
    await message.edit({
      ...buildValorantSessionMessage(session, { trollGachaEnabled }),
      attachments: [],
    });
    return true;
  } catch {
    return false;
  }
}

async function loadValorantTrollGachaEnabled(
  prisma: PrismaClient,
  guildId: string,
): Promise<boolean> {
  try {
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'valorant' } },
    });
    return Boolean(plugin?.enabled && normalizeValorantConfig(plugin?.config).trollGacha.enabled);
  } catch {
    return false;
  }
}

/** Minimal structural view of a discord.js VoiceState for the auto-join handler. */
interface ValorantVoiceStateLike {
  channelId?: string | null;
  member?: { user?: { id?: string; bot?: boolean } | null } | null;
}

interface ValorantRecruitmentClientLike {
  guilds?: {
    fetch?: (guildId: string) => Promise<{
      channels: {
        fetch: (channelId: string) => Promise<{
          isTextBased: () => boolean;
          messages: {
            fetch: (messageId: string) => Promise<{ edit: (options: unknown) => Promise<unknown> }>;
          };
        } | null>;
      };
    } | null>;
  };
}

/**
 * Event-driven variant of updatePublicValorantRecruitment (#1048): a
 * VoiceStateUpdate carries no interaction, so the recruitment message is
 * reached through the client. Failures only log — the DB stays the source
 * of truth and the next interaction-driven rebuild catches the display up.
 */
export async function syncValorantRecruitmentFromClient(
  client: unknown,
  prisma: PrismaClient,
  logger: Logger,
  session: ValorantSessionSnapshot,
): Promise<boolean> {
  try {
    if (!session.messageId) return false;
    const candidate = client as ValorantRecruitmentClientLike | null;
    if (typeof candidate?.guilds?.fetch !== 'function') return false;
    const guild = await candidate.guilds.fetch(session.guildId);
    if (!guild) return false;
    const channel = await guild.channels.fetch(session.channelId);
    if (!channel || !channel.isTextBased() || !channel.messages) return false;
    const message = await channel.messages.fetch(session.messageId);
    const trollGachaEnabled = await loadValorantTrollGachaEnabled(prisma, session.guildId);
    await message.edit({
      ...buildValorantSessionMessage(session, { trollGachaEnabled }),
      attachments: [],
    });
    return true;
  } catch (error) {
    logger.warn(
      {
        guildId: session.guildId,
        sessionId: session.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'VALORANT自動参加後の募集表示更新に失敗',
    );
    return false;
  }
}

/**
 * Discord reflection port for the portal API (S6-H2, #1050). The portal
 * operations layer talks to Discord only through this port so tests can
 * substitute a fake. Posting a recruitment message is the one operation
 * allowed to throw (creation must fail without leaving a session row);
 * every later reflection is fail-soft because the DB is the source of
 * truth and the next interaction-driven rebuild catches the display up.
 */
export interface ValorantPortalDiscordPort {
  postRecruitmentMessage(session: ValorantSessionSnapshot): Promise<string>;
  syncRecruitment(session: ValorantSessionSnapshot): Promise<boolean>;
  publishDrawResult(
    session: ValorantSessionSnapshot,
    displayName?: (userId: string) => string | undefined,
  ): Promise<boolean>;
}

interface ValorantPortalSendableChannel {
  isTextBased: () => boolean;
  send: (options: unknown) => Promise<{ id: string }>;
  messages: {
    fetch: (messageId: string) => Promise<{ edit: (options: unknown) => Promise<unknown> }>;
  };
}

export function createValorantPortalDiscordPort(
  client: unknown,
  prisma: PrismaClient,
  logger: Logger,
): ValorantPortalDiscordPort {
  const fetchChannel = async (
    session: ValorantSessionSnapshot,
  ): Promise<ValorantPortalSendableChannel> => {
    const candidate = client as ValorantRecruitmentClientLike | null;
    if (typeof candidate?.guilds?.fetch !== 'function') throw new Error('guild unavailable');
    const guild = await candidate.guilds.fetch(session.guildId);
    if (!guild) throw new Error('guild unavailable');
    const channel = (await guild.channels.fetch(
      session.channelId,
    )) as ValorantPortalSendableChannel | null;
    if (!channel || !channel.isTextBased()) throw new Error('channel unavailable');
    return channel;
  };
  return {
    async postRecruitmentMessage(session) {
      const channel = await fetchChannel(session);
      const trollGachaEnabled = await loadValorantTrollGachaEnabled(prisma, session.guildId);
      const message = await channel.send({
        ...buildValorantSessionMessage(session, { trollGachaEnabled }),
      });
      return message.id;
    },
    async syncRecruitment(session) {
      return syncValorantRecruitmentFromClient(client, prisma, logger, session);
    },
    async publishDrawResult(session, displayName) {
      try {
        if (!session.messageId) return false;
        const channel = await fetchChannel(session);
        const message = await channel.messages.fetch(session.messageId);
        const trollGachaEnabled = await loadValorantTrollGachaEnabled(prisma, session.guildId);
        await message.edit({
          ...(await buildValorantRichMessage(session, logger, displayName, {
            trollGachaEnabled,
          })),
        });
        return true;
      } catch (error) {
        logger.warn(
          {
            guildId: session.guildId,
            sessionId: session.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'VALORANTポータル抽選結果のDiscord投稿に失敗',
        );
        return false;
      }
    },
  };
}

/**
 * Live VC auto-join (#1048). bot.ts already drops bot users before
 * dispatching plugin events; the bot check below is repeated defensively.
 * Leaving a VC never removes a participant (existing policy) — only an
 * explicit leave does, which records an opt-out that the repository
 * mutation honors without ever clearing it. Most voice events are dropped
 * in memory before any DB access.
 */
async function handleValorantVoiceStateUpdate(
  context: {
    client: unknown;
    prisma: PrismaClient;
    logger: Logger;
    guildId: string;
    config: unknown;
  },
  oldState: ValorantVoiceStateLike | undefined,
  newState: ValorantVoiceStateLike | undefined,
): Promise<void> {
  try {
    if (!normalizeValorantConfig(context.config).enabled) return;
    const channelId = newState?.channelId ?? null;
    if (!channelId) return;
    if (oldState?.channelId === channelId) return;
    const user = newState?.member?.user;
    if (!user?.id || user.bot) return;
    const sessions = await findOpenValorantAutoJoinSessions(
      context.prisma,
      context.guildId,
      channelId,
    );
    for (const session of sessions) {
      try {
        const result = await autoJoinValorantSession(context.prisma, {
          guildId: context.guildId,
          id: session.id,
          userId: user.id,
          voiceChannelId: channelId,
        });
        if (result.status !== 'ok' || !result.changed) continue;
        context.logger.info(
          {
            guildId: context.guildId,
            sessionId: session.id,
            userId: user.id,
            becameFull: result.becameFull,
          },
          'VALORANT VC自動参加で参加者を登録',
        );
        await syncValorantRecruitmentFromClient(
          context.client,
          context.prisma,
          context.logger,
          result.session,
        );
      } catch (error) {
        context.logger.warn(
          {
            guildId: context.guildId,
            sessionId: session.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'VALORANT VC自動参加の登録に失敗',
        );
      }
    }
  } catch (error) {
    context.logger.warn(
      {
        guildId: context.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'VALORANT VC自動参加の処理に失敗',
    );
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
    const trollGachaEnabled = await loadValorantTrollGachaEnabled(prisma, guildId);
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
        !updated.changed ||
        (await updatePublicValorantRecruitment(interaction, updated.session, trollGachaEnabled));
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
      !mutation.changed ||
      (await updatePublicValorantRecruitment(interaction, mutation.session, trollGachaEnabled));
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

/** 人狼部屋の公開メッセージを DB 正本から再構築する (ephemeral 経由でも効くよう channel から辿る) */
async function syncWerewolfPublicMessage(
  interaction: ValorantManagedInteraction,
  prisma: PrismaClient,
  session: ValorantSessionSnapshot,
): Promise<boolean> {
  try {
    if (!interaction.guild || !session.messageId) return false;
    const channel = await interaction.guild.channels.fetch(session.channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return false;
    const message = await channel.messages.fetch(session.messageId);
    await message.edit({
      ...(await buildWerewolfMessageForState(prisma, session)),
      attachments: [],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 投票期限を過ぎていたら、その interaction を契機に遅延締切する
 * (scheduler は入れない)。締め切ったら true。
 */
async function lazyCloseWerewolfIfExpired(
  interaction: ValorantManagedInteraction,
  prisma: PrismaClient,
  logger: Logger,
  session: ValorantSessionSnapshot,
): Promise<boolean> {
  const progress = await getValorantWerewolfVoteProgress(prisma, session.guildId, session.id);
  const game = progress?.game;
  if (!game || (game.phase !== 'VOTING' && game.phase !== 'RUNOFF')) return false;
  if (!game.voteEndsAt || game.voteEndsAt.getTime() > Date.now()) return false;
  const settled = await closeValorantWerewolfRoundAndSettle(
    prisma,
    {
      guildId: session.guildId,
      sessionId: session.id,
      userId: session.creatorId,
      isAdmin: true,
      reason: 'expired',
      apiConfig: resolveValorantTrollApiConfig(process.env),
    },
    { logger },
  );
  if (settled.status !== 'ok') return false;
  await syncWerewolfPublicMessage(interaction, prisma, settled.session);
  return true;
}

/**
 * 人狼部屋のボタン / 投票セレクトの処理 (#1049)。
 * 呼び出し側で ephemeral に deferReply 済み。公開メッセージの更新は
 * DB 正本から再構築する。秘密は wolf-secret の ephemeral 応答でのみ
 * 本人へ返し、公開側・ログへは出さない。
 */
async function handleValorantWerewolfInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  prisma: PrismaClient,
  logger: Logger,
  session: ValorantSessionSnapshot,
  parsed: { id: string; action: string },
  config: ValorantPluginConfig,
): Promise<void> {
  const guildId = session.guildId;
  const isAdmin = Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
  );
  const action = parsed.action;
  const reply = async (content: string) => {
    await interaction.editReply(content);
  };

  if (action === 'draw' || action === 'reroll' || action === 'troll-off') {
    await reply('人狼モードでは使えません。');
    return;
  }

  if (action === 'join' || action === 'leave') {
    const mutation = await mutateValorantSession(prisma, {
      guildId,
      id: parsed.id,
      userId: interaction.user.id,
      action,
      isAdmin,
    });
    if (mutation.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '募集が見つかりません。',
        closed: '募集は終了済み、または期限切れです。',
        full: 'この部屋は定員です。',
        not_joined: 'まだ参加していません。',
      };
      await reply(messages[mutation.status] ?? '操作できませんでした。');
      return;
    }
    if (mutation.changed) {
      await syncWerewolfPublicMessage(interaction, prisma, mutation.session);
    }
    await reply(
      action === 'join'
        ? mutation.changed
          ? '参加しました。'
          : 'すでに参加済みです。'
        : '参加を取り消しました。',
    );
    return;
  }

  if (action === 'wolf-start') {
    const displayNames = new Map<string, string>();
    for (const [index, participant] of session.participants.entries()) {
      const member =
        interaction.guild?.members.cache.get(participant.userId) ??
        (await interaction.guild?.members.fetch(participant.userId).catch(() => null));
      displayNames.set(participant.userId, member?.displayName ?? `参加者${index + 1}`);
    }
    const result = await startValorantWerewolf(
      prisma,
      {
        guildId,
        sessionId: session.id,
        userId: interaction.user.id,
        isAdmin,
        displayNames,
        apiConfig: resolveValorantTrollApiConfig(process.env),
        rarityFilter: config.trollGacha.rarityFilter,
      },
      { logger },
    );
    if (result.status === 'ok') {
      await syncWerewolfPublicMessage(interaction, prisma, result.session);
      await reply(
        '人狼を決定し、秘密の縛りを配りました。「自分の縛りを確認」ボタンで本人だけが確認できます。',
      );
      return;
    }
    if (result.status === 'assignment_failed') {
      await syncWerewolfPublicMessage(interaction, prisma, result.session);
      await reply(
        '縛りの抽選に失敗したため開始を保留しています。参加者は固定済みです。復旧後に「開始リトライ」を押してください。',
      );
      return;
    }
    const messages: Record<string, string> = {
      missing: '部屋が見つかりません。',
      closed: 'すでに開始済み、または終了しています。',
      forbidden: '開始は作成者または管理者のみ可能です。',
      insufficient: '開始には3人以上の参加者が必要です。',
      not_werewolf: '人狼モードの部屋ではありません。',
      invalid: '開始できませんでした。',
    };
    await reply(messages[result.status] ?? '開始できませんでした。');
    return;
  }

  if (action === 'wolf-secret') {
    const secret = await getValorantWerewolfSecretForUser(
      prisma,
      guildId,
      session.id,
      interaction.user.id,
    );
    if (secret.kind === 'werewolf') {
      await markValorantWerewolfSecretViewed(prisma, guildId, session.id).catch(() => undefined);
      await reply('🎭 あなたの秘密の縛り：\n' + formatValorantTrollEmbedText(secret.troll));
    } else if (secret.kind === 'citizen') {
      await reply('あなたに秘密の縛りはありません。');
    } else if (secret.kind === 'werewolf_not_ready') {
      await reply('秘密の縛りはまだ配られていません。開始処理の完了をお待ちください。');
    } else if (secret.kind === 'not_participant') {
      await reply('この部屋の参加者ではありません。');
    } else if (secret.kind === 'not_started') {
      await reply('まだ開始していません。');
    } else {
      await reply('部屋が見つかりません。');
    }
    return;
  }

  if (action === 'wolf-vote-open') {
    const opened = await openValorantWerewolfVote(prisma, {
      guildId,
      id: session.id,
      userId: interaction.user.id,
      isAdmin,
    });
    if (opened.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '部屋が見つかりません。',
        closed: 'この部屋は進行中ではありません。',
        forbidden: '投票開始は作成者または管理者のみ可能です。',
        wrong_phase: '現在の状態では投票を開始できません。',
      };
      await reply(messages[opened.status] ?? '投票を開始できませんでした。');
      return;
    }
    await syncWerewolfPublicMessage(interaction, prisma, opened.session);
    await reply('投票を開始しました。参加者は「投票する」ボタンから投票できます。');
    return;
  }

  if (action === 'wolf-vote') {
    if (await lazyCloseWerewolfIfExpired(interaction, prisma, logger, session)) {
      await reply('投票期限を過ぎたため締め切りました。');
      return;
    }
    const state = await getValorantWerewolfState(prisma, guildId, session.id);
    const game = state?.game;
    if (!game || (game.phase !== 'VOTING' && game.phase !== 'RUNOFF')) {
      await reply('現在は投票を受け付けていません。');
      return;
    }
    const roster = parseWerewolfRoster(game.rosterSnapshot);
    if (!roster.some((entry) => entry.userId === interaction.user.id)) {
      await reply('参加者だけが投票できます。');
      return;
    }
    const candidates = roster.filter((entry) =>
      game.currentCandidateUserIds.includes(entry.userId),
    );
    await interaction.editReply({
      content:
        (game.phase === 'RUNOFF' ? '決選投票：' : '投票：') +
        '投票先を1人選んでください。自分には投票できません。締切までは変更できます。',
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(sessionCustomId(session.id, 'wolf-vote-cast-' + game.currentRound))
            .setPlaceholder('投票先を選択')
            .addOptions(
              candidates.map((entry) => ({
                label: entry.displayName.slice(0, 100),
                value: entry.userId,
              })),
            ),
        ),
      ],
    });
    return;
  }

  if (action.startsWith('wolf-vote-cast-')) {
    if (!interaction.isStringSelectMenu()) {
      await reply('操作形式が不正です。');
      return;
    }
    const round = Number.parseInt(action.slice('wolf-vote-cast-'.length), 10);
    const targetUserId = interaction.values[0];
    if (!targetUserId) {
      await reply('投票先を確認できません。');
      return;
    }
    if (await lazyCloseWerewolfIfExpired(interaction, prisma, logger, session)) {
      await reply('投票期限を過ぎたため締め切りました。あなたの投票は反映されませんでした。');
      return;
    }
    const cast = await castValorantWerewolfVote(prisma, {
      guildId,
      id: session.id,
      voterUserId: interaction.user.id,
      targetUserId,
      round,
    });
    if (cast.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '部屋が見つかりません。',
        not_voting: '現在は投票を受け付けていません。',
        stale_round: 'この投票はすでに締め切られています。',
        not_participant: '参加者だけが投票できます。',
        not_candidate: 'そのメンバーは現在の候補者ではありません。',
        self_vote: '自分には投票できません。',
      };
      await reply(messages[cast.status] ?? '投票できませんでした。');
      return;
    }
    if (cast.allVoted) {
      const settled = await closeValorantWerewolfRoundAndSettle(
        prisma,
        {
          guildId,
          sessionId: session.id,
          userId: interaction.user.id,
          isAdmin,
          reason: 'all_voted',
          apiConfig: resolveValorantTrollApiConfig(process.env),
        },
        { logger },
      );
      if (settled.status === 'ok') {
        await syncWerewolfPublicMessage(interaction, prisma, settled.session);
        await reply(
          settled.kind === 'runoff'
            ? '投票しました。全員の投票が揃い、同票のため決選投票に進みます。'
            : '投票しました。全員の投票が揃ったため締め切り、結果が確定しました。',
        );
        return;
      }
    }
    const latest = await getValorantSession(prisma, guildId, session.id);
    if (latest) await syncWerewolfPublicMessage(interaction, prisma, latest);
    await reply('投票しました。締切までは「投票する」ボタンから変更できます。');
    return;
  }

  if (action === 'wolf-close') {
    const state = await getValorantWerewolfState(prisma, guildId, session.id);
    const game = state?.game;
    if (!game || (game.phase !== 'VOTING' && game.phase !== 'RUNOFF')) {
      await reply('現在は締め切れる投票がありません。');
      return;
    }
    await interaction.editReply({
      content: '投票を締め切りますか？未投票者は棄権として扱います。',
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(sessionCustomId(session.id, 'wolf-close-confirm-' + game.currentRound))
            .setLabel('締切を確定')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
    return;
  }

  if (action.startsWith('wolf-close-confirm-')) {
    const round = Number.parseInt(action.slice('wolf-close-confirm-'.length), 10);
    const progress = await getValorantWerewolfVoteProgress(prisma, guildId, session.id);
    if (
      !progress ||
      (progress.game.phase !== 'VOTING' && progress.game.phase !== 'RUNOFF') ||
      progress.game.currentRound !== round
    ) {
      await reply('ラウンドが進んでいるため、この確認は無効です。');
      return;
    }
    if (await lazyCloseWerewolfIfExpired(interaction, prisma, logger, session)) {
      await reply('投票期限を過ぎていたため、期限切れとして締め切りました。');
      return;
    }
    const settled = await closeValorantWerewolfRoundAndSettle(
      prisma,
      {
        guildId,
        sessionId: session.id,
        userId: interaction.user.id,
        isAdmin,
        reason: 'manual',
        apiConfig: resolveValorantTrollApiConfig(process.env),
      },
      { logger },
    );
    if (settled.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '部屋が見つかりません。',
        forbidden: '締切は作成者または管理者のみ可能です。',
        wrong_phase: '現在は締め切れません。',
        closed: 'すでに終了しています。',
      };
      await reply(messages[settled.status] ?? '締め切れませんでした。');
      return;
    }
    await syncWerewolfPublicMessage(interaction, prisma, settled.session);
    await reply(
      settled.kind === 'runoff'
        ? '同票のため決選投票に進みます。'
        : settled.kind === 'no_votes'
          ? '投票がなかったため、この部屋は中止しました。'
          : '結果が確定しました。',
    );
    return;
  }

  if (action === 'wolf-cancel' || action === 'cancel') {
    const aborted = await abortValorantWerewolfGame(prisma, {
      guildId,
      id: session.id,
      userId: interaction.user.id,
      isAdmin,
    });
    if (aborted.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '部屋が見つかりません。',
        closed: 'すでに終了しています。',
        forbidden: '中止は作成者または管理者のみ可能です。',
        not_werewolf: '人狼モードの部屋ではありません。',
      };
      await reply(messages[aborted.status] ?? '中止できませんでした。');
      return;
    }
    if (aborted.changed) {
      await syncWerewolfPublicMessage(interaction, prisma, aborted.session);
    }
    await reply('部屋を中止しました。秘密は公開されません。');
    return;
  }

  if (action === 'wolf-punishment-retry') {
    const retried = await retryValorantWerewolfPunishment(
      prisma,
      {
        guildId,
        sessionId: session.id,
        userId: interaction.user.id,
        isAdmin,
        apiConfig: resolveValorantTrollApiConfig(process.env),
      },
      { logger },
    );
    if (retried.status !== 'ok') {
      const messages: Record<string, string> = {
        missing: '部屋が見つかりません。',
        forbidden: '罰ゲームの引き直しは作成者または管理者のみ可能です。',
        wrong_phase: '今は引き直せません。',
        closed: 'すでに終了しています。',
        not_pending: '今は引き直せません。',
      };
      await reply(messages[retried.status] ?? '引き直せませんでした。');
      return;
    }
    await syncWerewolfPublicMessage(interaction, prisma, retried.session);
    await reply('罰ゲームを確定しました。');
    return;
  }

  await reply('未対応の人狼操作です。');
}

async function handleValorantButton(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
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
    // 人狼の投票セレクトは ephemeral メッセージから届くため、その場合だけ
    // 公開メッセージ ID との一致を求めない (チャンネル一致は維持する)
    const isWerewolfVoteSelect = parsed.action.startsWith('wolf-vote-cast-');
    if (
      !session ||
      (session.messageId &&
        session.messageId !== interaction.message.id &&
        !isWerewolfVoteSelect) ||
      session.channelId !== interaction.channelId
    ) {
      await interaction.editReply('対象の募集が見つかりません。');
      return;
    }
    // Config is loaded for every action so the troll-gacha display flag
    // stays consistent across message rebuilds; only draw/reroll are
    // gated on the plugin being enabled, as before.
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'valorant' } },
    });
    const config = normalizeValorantConfig(plugin?.config);
    // 人狼部屋 (#1049) と人狼アクションは専用ハンドラへ委譲する
    if (session.mode === 'WEREWOLF' || parsed.action.startsWith('wolf-')) {
      await handleValorantWerewolfInteraction(interaction, prisma, logger, session, parsed, config);
      return;
    }
    let candidates: ValorantCandidate[] = [];
    if (parsed.action === 'draw' || parsed.action === 'reroll') {
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
    if (parsed.action === 'troll-off') {
      if (!config.trollGacha.enabled) {
        await interaction.editReply('縛り（トロールガチャ）合流は現在無効です。');
        return;
      }
      const toggled = await toggleValorantSessionTrollOff(prisma, {
        guildId,
        id: parsed.id,
        userId: interaction.user.id,
      });
      if (toggled.status !== 'ok') {
        await interaction.editReply(
          toggled.status === 'not_joined'
            ? '参加者だけが縛りオフを切り替えられます。先に参加してください。'
            : toggled.status === 'closed'
              ? '募集は終了済み、または期限切れのため切り替えできません。'
              : '対象の募集が見つかりません。',
        );
        return;
      }
      try {
        await interaction.message.edit({
          ...buildValorantSessionMessage(toggled.session, { trollGachaEnabled: true }),
          attachments: [],
        });
      } catch (error) {
        logger.warn(
          { guildId, errorName: error instanceof Error ? error.name : 'UnknownError' },
          'VALORANT縛りオフ表示の更新に失敗',
        );
        await interaction.editReply(
          '縛りオフはDBへ保存済みですが、Discordの表示更新に失敗しました。',
        );
        return;
      }
      await interaction.editReply(
        toggled.session.trollOffUserIds.includes(interaction.user.id)
          ? '縛りオフにしました。この募集の抽選では、あなたに縛りは付きません。'
          : '縛りオフを解除しました。この募集の抽選では、あなたも縛りの対象です。',
      );
      return;
    }
    const mutation =
      parsed.action === 'reroll'
        ? await rerollValorantSession(prisma, {
            guildId,
            id: parsed.id,
            messageId: interaction.message.id,
            userId: interaction.user.id,
            isAdmin,
            candidates,
            sessionDurationMinutes: config.sessionDurationMinutes,
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
            .edit({
              ...(await buildValorantRichMessage(latest, logger, undefined, {
                trollGachaEnabled: config.trollGacha.enabled,
              })),
              attachments: [],
            })
            .catch(() => undefined);
      }
      await interaction.editReply(messages[mutation.status] ?? '操作できませんでした。');
      return;
    }
    let displaySession = mutation.session;
    if (mutation.changed && (parsed.action === 'draw' || parsed.action === 'reroll')) {
      displaySession = await applyValorantTrollsToSession(prisma, logger, mutation.session, {
        operatorId: interaction.user.id,
        config,
        displayName: (id) => interaction.guild?.members.cache.get(id)?.displayName,
      });
    }
    if (mutation.changed) {
      try {
        await interaction.message.edit({
          ...(await buildValorantRichMessage(
            displaySession,
            logger,
            (id) => interaction.guild?.members.cache.get(id)?.displayName,
            { trollGachaEnabled: config.trollGacha.enabled },
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
          } else if (subcommand === 'werewolf') {
            await handleWerewolf(interaction, context.prisma, context.logger);
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
            (candidate.isButton() &&
              ['join', 'leave', 'draw', 'cancel', 'reroll', 'troll-off'].includes(parsed.action)) ||
            // 人狼ボタンと投票セレクト (#1049) も同じ入口で処理する
            (candidate.isButton() && parsed.action.startsWith('wolf-')) ||
            (candidate.isStringSelectMenu() && parsed.action.startsWith('wolf-vote-cast-'))
          ) {
            await handleValorantButton(
              candidate as ButtonInteraction | StringSelectMenuInteraction,
              context.prisma,
              context.logger,
            );
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
      {
        event: 'voiceStateUpdate',
        async handler(_context, ...args) {
          await handleValorantVoiceStateUpdate(
            context,
            args[0] as ValorantVoiceStateLike | undefined,
            args[1] as ValorantVoiceStateLike | undefined,
          );
        },
      },
    ] as PluginEventHandler<ValorantPluginConfig>[];
  },
});
