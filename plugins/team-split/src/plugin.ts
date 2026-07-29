import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import { parseTeamSplitComponentId } from './component-id.js';
import {
  TeamSplitValidationError,
  normalizeTeamSplitConfig,
  type TeamSplitConfig,
  type TeamSplitMode,
} from './config.js';
import { teamSplitManifest } from './manifest.js';
import {
  buildTeamSplitInteractionMessage,
  formatTeamSplitSessionText,
  type TeamSplitInteractionMessagePayload,
} from './presentation.js';
import {
  closeTeamSplitSession,
  createTeamSplitSession,
  getTeamSplitSession,
  joinTeamSplitSession,
  leaveTeamSplitSession,
  listTeamSplitParticipants,
  markTeamSplitMessageMissing,
  markTeamSplitMessageSynchronized,
  removeTeamSplitParticipant,
  rerollTeamSplitSession,
  splitTeamSplitSession,
  updateTeamSplitMessageReference,
  type TeamSplitPrismaClient,
  type TeamSplitSessionRecord,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface TeamSplitCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
  getUser(name: string, required?: boolean): { id: string } | null;
}

interface TeamSplitMessageLike {
  id: string;
  edit(options: TeamSplitInteractionMessagePayload): Promise<unknown>;
}

interface TeamSplitChannelLike {
  id: string;
  type?: number;
  messages?: { fetch(messageId: string): Promise<TeamSplitMessageLike> };
}

interface TeamSplitDiscordClient {
  channels: { fetch(channelId: string): Promise<TeamSplitChannelLike | null> };
}

interface TeamSplitReplyOptions extends Partial<TeamSplitInteractionMessagePayload> {
  content?: string;
  flags?: number;
  fetchReply?: boolean;
  allowedMentions: { parse: string[] };
}

interface TeamSplitCommandInteraction {
  id: string;
  guildId: string | null;
  channelId: string | null;
  user: { id: string };
  memberPermissions: PermissionSet | null;
  options: TeamSplitCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: TeamSplitReplyOptions): Promise<unknown>;
  followUp(options: TeamSplitReplyOptions): Promise<unknown>;
}

interface TeamSplitButtonInteraction {
  guildId: string | null;
  customId: string;
  user: { id: string };
  message: { id: string };
  replied: boolean;
  deferred: boolean;
  isButton(): boolean;
  reply(options: TeamSplitReplyOptions): Promise<unknown>;
  followUp(options: TeamSplitReplyOptions): Promise<unknown>;
  update(options: TeamSplitInteractionMessagePayload): Promise<unknown>;
}

interface TeamSplitDeletedMessage {
  id: string;
  guildId: string | null;
}

type TeamSplitRuntimeContext = PluginRuntimeContext<
  TeamSplitConfig,
  TeamSplitDiscordClient,
  TeamSplitPrismaClient
>;

export const teamSplitPlugin = definePlugin<
  TeamSplitConfig,
  TeamSplitDiscordClient,
  TeamSplitPrismaClient
>({
  manifest: teamSplitManifest,

  async onEnable(context) {
    normalizeTeamSplitConfig(context.config);
    getTeamSplitSecret();
    context.logger.info('Team Split Plugin v1を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('Team Split Plugin v1を無効化しました');
  },

  provideCommands(context) {
    const command: CommandHandler<TeamSplitCommandInteraction> = {
      definition: teamSplitManifest.commands[0]!,
      async execute(interaction) {
        await executeTeamSplitCommand(context, interaction);
      },
    };
    return [command];
  },

  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as TeamSplitButtonInteraction | undefined;
          if (!interaction?.isButton()) return;
          try {
            await executeTeamSplitButton(context, interaction);
          } catch (error) {
            context.logger.error(
              { guildId: context.guildId, errorName: resolveErrorName(error) },
              'Team Split Button処理に失敗しました',
            );
            if (!interaction.replied && !interaction.deferred) {
              await respond(interaction, 'Team Splitの処理に失敗しました');
            }
          }
        },
      },
      {
        event: 'messageDelete',
        async handler(context, ...args) {
          const message = args[0] as TeamSplitDeletedMessage | undefined;
          if (!message?.guildId || message.guildId !== context.guildId) return;
          try {
            await markTeamSplitMessageMissing(context.prisma, {
              guildId: context.guildId,
              messageId: message.id,
            });
          } catch (error) {
            context.logger.warn(
              { guildId: context.guildId, errorName: resolveErrorName(error) },
              'Team Splitメッセージ削除状態の記録に失敗しました',
            );
          }
        },
      },
    ];
  },
});

async function executeTeamSplitCommand(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId || !interaction.channelId) {
    await respond(interaction, 'このコマンドは対象サーバー内でのみ利用できます');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'create') {
      await createFromCommand(context, interaction);
      return;
    }
    if (subcommand === 'add') {
      await addFromCommand(context, interaction);
      return;
    }
    if (subcommand === 'remove') {
      await removeFromCommand(context, interaction);
      return;
    }
    if (subcommand === 'split' || subcommand === 'reroll' || subcommand === 'close') {
      await executeSessionAction(context, interaction, subcommand);
      return;
    }
    if (subcommand === 'show') {
      await showSession(context, interaction);
      return;
    }
    await respond(interaction, '未対応のサブコマンドです');
  } catch (error) {
    if (error instanceof TeamSplitValidationError) {
      await respond(interaction, error.message);
      return;
    }
    context.logger.error(
      { guildId: context.guildId, subcommand, errorName: resolveErrorName(error) },
      'Team Splitコマンドの処理に失敗しました',
    );
    await respond(interaction, 'Team Splitの処理に失敗しました。時間をおいて再度お試しください');
  }
}

async function createFromCommand(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
): Promise<void> {
  const title = interaction.options.getString('title', true)?.trim();
  const teamCount = interaction.options.getInteger('team_count', true);
  const mode = interaction.options.getString('mode', true);
  const maxParticipants = interaction.options.getInteger('max_participants', true);
  if (!title || teamCount === null || !isTeamSplitMode(mode) || maxParticipants === null) {
    await respond(interaction, 'title、team_count、mode、max_participantsを指定してください');
    return;
  }

  const session = await createTeamSplitSession(context.prisma, {
    guildId: context.guildId,
    creatorId: interaction.user.id,
    actorId: interaction.user.id,
    session: {
      channelId: interaction.channelId!,
      title,
      teamCount,
      mode,
      maxParticipants,
      durationMinutes: interaction.options.getInteger('duration_minutes'),
      seed: interaction.options.getString('seed'),
    },
    creatorScore: interaction.options.getInteger('creator_score'),
    config: normalizeTeamSplitConfig(context.config),
    secret: getTeamSplitSecret(),
  });
  const participants = await listTeamSplitParticipants(context.prisma, context.guildId, session.id);

  try {
    const reply = await interaction.reply({
      ...buildTeamSplitInteractionMessage(session, participants, getTeamSplitSecret()),
      fetchReply: true,
    });
    const messageId = readMessageId(reply);
    if (messageId) {
      await updateTeamSplitMessageReference(context.prisma, {
        guildId: context.guildId,
        sessionId: session.id,
        messageId,
        actorId: interaction.user.id,
        expectedVersion: session.version,
      });
    }
  } catch (error) {
    await context.prisma.teamSplitSession.update({
      where: { id: session.id },
      data: { messageState: 'failed', lastErrorName: resolveErrorName(error) },
    });
    throw error;
  }
}

async function addFromCommand(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
): Promise<void> {
  const sessionId = interaction.options.getString('id', true)?.trim();
  const target = interaction.options.getUser('user', true);
  if (!sessionId || !target) {
    await respond(interaction, 'セッションIDと対象ユーザーを指定してください');
    return;
  }
  const session = await getTeamSplitSession(context.prisma, context.guildId, sessionId);
  if (!session) {
    await respond(interaction, '指定したセッションが見つかりません');
    return;
  }
  if (!canManageSession(session, interaction)) {
    await respond(
      interaction,
      '作成者または「サーバーの管理」権限を持つユーザーだけが操作できます',
    );
    return;
  }
  const result = await joinTeamSplitSession(context.prisma, {
    guildId: context.guildId,
    sessionId,
    userId: target.id,
    score: interaction.options.getInteger('score'),
    actorId: interaction.user.id,
  });
  if (result.state === 'not_found') {
    await respond(interaction, '指定したセッションが見つかりません');
    return;
  }
  if (result.state === 'full') {
    await respond(interaction, 'このセッションは満員です');
    return;
  }
  if (result.state === 'locked') {
    await respond(interaction, '分割済みまたは終了済みのセッションは変更できません');
    return;
  }
  await refreshTeamSplitMessage(context, result.session);
  await respond(
    interaction,
    result.state === 'updated' ? '参加者のscoreを更新しました' : '参加者を追加しました',
  );
}

async function removeFromCommand(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
): Promise<void> {
  const sessionId = interaction.options.getString('id', true)?.trim();
  const target = interaction.options.getUser('user', true);
  if (!sessionId || !target) {
    await respond(interaction, 'セッションIDと対象ユーザーを指定してください');
    return;
  }
  const result = await removeTeamSplitParticipant(context.prisma, {
    guildId: context.guildId,
    sessionId,
    targetUserId: target.id,
    actorId: interaction.user.id,
    force: interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION) ?? false,
  });
  if (result.state === 'not_found') {
    await respond(interaction, '指定したセッションが見つかりません');
    return;
  }
  if (result.state === 'forbidden') {
    await respond(
      interaction,
      '作成者または「サーバーの管理」権限を持つユーザーだけが操作できます',
    );
    return;
  }
  if (result.state === 'creator_must_close') {
    await respond(interaction, '作成者は削除できません。セッションをcloseしてください');
    return;
  }
  if (result.state === 'not_joined') {
    await respond(interaction, '対象ユーザーは参加していません');
    return;
  }
  if (result.state === 'locked') {
    await respond(interaction, '分割済みまたは終了済みのセッションは変更できません');
    return;
  }
  await refreshTeamSplitMessage(context, result.session);
  await respond(interaction, '参加者を削除しました');
}

async function executeSessionAction(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
  action: 'split' | 'reroll' | 'close',
): Promise<void> {
  const sessionId = interaction.options.getString('id', true)?.trim();
  if (!sessionId) {
    await respond(interaction, 'セッションIDを指定してください');
    return;
  }
  const common = {
    guildId: context.guildId,
    sessionId,
    actorId: interaction.user.id,
    force: interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION) ?? false,
  };
  const result =
    action === 'split'
      ? await splitTeamSplitSession(context.prisma, common)
      : action === 'reroll'
        ? await rerollTeamSplitSession(context.prisma, common)
        : await closeTeamSplitSession(context.prisma, common);

  if (result.state === 'not_found') {
    await respond(interaction, '指定したセッションが見つかりません');
    return;
  }
  if (result.state === 'forbidden') {
    await respond(
      interaction,
      '作成者または「サーバーの管理」権限を持つユーザーだけが操作できます',
    );
    return;
  }
  if (result.state === 'not_enough_participants') {
    await respond(interaction, '参加者数がチーム数に達していません');
    return;
  }
  if (result.state === 'invalid_state') {
    await respond(interaction, '現在の状態ではこの操作を実行できません');
    return;
  }
  await refreshTeamSplitMessage(context, result.session);
  await respond(
    interaction,
    action === 'split'
      ? 'チーム分けを実行しました'
      : action === 'reroll'
        ? 'チームを再抽選しました'
        : 'セッションを終了しました',
  );
}

async function showSession(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitCommandInteraction,
): Promise<void> {
  const sessionId = interaction.options.getString('id', true)?.trim();
  if (!sessionId) {
    await respond(interaction, 'セッションIDを指定してください');
    return;
  }
  const session = await getTeamSplitSession(context.prisma, context.guildId, sessionId);
  if (!session) {
    await respond(interaction, '指定したセッションが見つかりません');
    return;
  }
  const participants = await listTeamSplitParticipants(context.prisma, context.guildId, session.id);
  await respond(interaction, formatTeamSplitSessionText(session, participants));
}

async function executeTeamSplitButton(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  if (!interaction.customId.startsWith('team:')) return;
  const parsed = parseTeamSplitComponentId(interaction.customId, getTeamSplitSecret(), new Date());
  if (!parsed) {
    await respond(interaction, 'このTeam Splitボタンは無効または期限切れです');
    return;
  }

  if (parsed.action === 'join') {
    const result = await joinTeamSplitSession(context.prisma, {
      guildId: context.guildId,
      sessionId: parsed.sessionId,
      userId: interaction.user.id,
      score: 0,
    });
    if (result.state === 'not_found') {
      await respond(interaction, 'セッションが見つかりません');
      return;
    }
    if (result.state === 'already_joined') {
      await respond(interaction, '既に参加しています');
      return;
    }
    if (result.state === 'full') {
      await respond(interaction, 'このセッションは満員です');
      return;
    }
    if (result.state === 'locked') {
      await respond(interaction, 'このセッションの参加受付は終了しています');
      return;
    }
    await updateButtonMessage(context, interaction, result.session);
    return;
  }

  const result = await leaveTeamSplitSession(context.prisma, {
    guildId: context.guildId,
    sessionId: parsed.sessionId,
    userId: interaction.user.id,
  });
  if (result.state === 'not_found') {
    await respond(interaction, 'セッションが見つかりません');
    return;
  }
  if (result.state === 'creator_must_close') {
    await respond(interaction, '作成者は辞退できません。`/team close`を使用してください');
    return;
  }
  if (result.state === 'not_joined') {
    await respond(interaction, 'このセッションには参加していません');
    return;
  }
  if (result.state === 'locked') {
    await respond(interaction, 'このセッションの参加受付は終了しています');
    return;
  }
  await updateButtonMessage(context, interaction, result.session);
}

async function updateButtonMessage(
  context: TeamSplitRuntimeContext,
  interaction: TeamSplitButtonInteraction,
  session: TeamSplitSessionRecord,
): Promise<void> {
  const participants = await listTeamSplitParticipants(context.prisma, context.guildId, session.id);
  try {
    await interaction.update(
      buildTeamSplitInteractionMessage(session, participants, getTeamSplitSecret()),
    );
    await markTeamSplitMessageSynchronized(context.prisma, {
      guildId: context.guildId,
      sessionId: session.id,
      expectedVersion: session.version,
    });
  } catch (error) {
    context.logger.warn(
      { guildId: context.guildId, sessionId: session.id, errorName: resolveErrorName(error) },
      'Team Split Button操作後の表示更新に失敗しました。Workerで再同期します',
    );
    if (!interaction.replied && !interaction.deferred) {
      await respond(interaction, '参加状態は更新されました。表示はWorkerが再同期します');
    }
  }
}

async function refreshTeamSplitMessage(
  context: TeamSplitRuntimeContext,
  session: TeamSplitSessionRecord,
): Promise<void> {
  if (!session.messageId) return;
  try {
    const channel = await context.client.channels.fetch(session.channelId);
    if (!channel || (channel.type !== undefined && !TEXT_CHANNEL_TYPES.has(channel.type))) return;
    const message = await channel.messages?.fetch(session.messageId);
    if (!message) return;
    const participants = await listTeamSplitParticipants(
      context.prisma,
      context.guildId,
      session.id,
    );
    await message.edit(
      buildTeamSplitInteractionMessage(session, participants, getTeamSplitSecret()),
    );
    await markTeamSplitMessageSynchronized(context.prisma, {
      guildId: context.guildId,
      sessionId: session.id,
      expectedVersion: session.version,
    });
  } catch (error) {
    if (isUnknownMessageError(error)) {
      await markTeamSplitMessageMissing(context.prisma, {
        guildId: context.guildId,
        messageId: session.messageId,
        errorName: resolveErrorName(error),
      });
      return;
    }
    await context.prisma.teamSplitSession.update({
      where: { id: session.id },
      data: { messageState: 'failed', lastErrorName: resolveErrorName(error) },
    });
  }
}

function isUnknownMessageError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; status?: unknown; rawError?: { code?: unknown } };
  return candidate.code === 10008 || candidate.rawError?.code === 10008 || candidate.status === 404;
}

function canManageSession(
  session: TeamSplitSessionRecord,
  interaction: TeamSplitCommandInteraction,
): boolean {
  return (
    session.creatorId === interaction.user.id ||
    (interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION) ?? false)
  );
}

async function respond(
  interaction: Pick<TeamSplitCommandInteraction, 'replied' | 'deferred' | 'reply' | 'followUp'>,
  content: string,
): Promise<void> {
  const options: TeamSplitReplyOptions = {
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

function isTeamSplitMode(value: string | null): value is TeamSplitMode {
  return value === 'random' || value === 'balanced';
}

function getTeamSplitSecret(): string {
  const secret = process.env['TEAM_SPLIT_SECRET'] ?? '';
  if (secret.length < 32) throw new Error('TEAM_SPLIT_SECRETは32文字以上で設定してください');
  return secret;
}

function readMessageId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name.slice(0, 120);
  return 'UnknownError';
}
