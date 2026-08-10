import { onboardingManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const MANAGE_ROLES_PERMISSION = 268435456n;
const DISCORD_ID_PATTERN = /^\d+$/;
const MAX_AUTO_ROLES = 10;
const MAX_MESSAGE_LENGTH = 1500;

export interface OnboardingConfig {
  enabled: boolean;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string | null;
  goodbyeMessage: string;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  mentionNewMember: boolean;
}

export interface OnboardingTemplateContext {
  userId: string;
  username: string;
  serverName: string;
  memberCount: number;
}

interface OnboardingPermissions {
  has(permission: bigint): boolean;
}

interface OnboardingRole {
  id: string;
  managed: boolean;
  editable: boolean;
}

interface OnboardingChannel {
  isTextBased(): boolean;
  send(options: {
    content: string;
    allowedMentions: { parse: []; users?: string[] };
  }): Promise<unknown>;
}

interface OnboardingGuild {
  id: string;
  name: string;
  memberCount: number;
  members: {
    me: { permissions: OnboardingPermissions } | null;
  };
  roles: {
    fetch(roleId: string): Promise<OnboardingRole | null>;
  };
  channels: {
    fetch(channelId: string): Promise<OnboardingChannel | null>;
  };
}

interface OnboardingMember {
  id: string;
  user: { id: string; username: string; bot?: boolean };
  guild: OnboardingGuild;
  roles: {
    add(roleIds: string[]): Promise<unknown>;
  };
}

interface OnboardingCommandOptions {
  getSubcommand(): string;
}

interface OnboardingCommandInteraction {
  guildId: string | null;
  guild: OnboardingGuild | null;
  channel: OnboardingChannel | null;
  memberPermissions: OnboardingPermissions | null;
  user: { id: string; username: string };
  options: OnboardingCommandOptions;
  reply(options: {
    content: string;
    flags?: number;
    allowedMentions: { parse: []; users?: string[] };
  }): Promise<unknown>;
}

type OnboardingRuntimeContext = PluginRuntimeContext<OnboardingConfig>;

export const onboardingPlugin = definePlugin<OnboardingConfig>({
  manifest: onboardingManifest,
  provideCommands(context) {
    const command: CommandHandler<OnboardingCommandInteraction> = {
      definition: onboardingManifest.commands[0]!,
      async execute(interaction) {
        await executeWelcomeCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return createOnboardingEvents() as PluginEventHandler<OnboardingConfig>[];
  },
});

function createOnboardingEvents(): PluginEventHandler<OnboardingConfig>[] {
  return [
    {
      event: 'guildMemberAdd',
      async handler(context, ...args) {
        const member = args[0] as OnboardingMember | undefined;
        if (member) await handleMemberAdd(context, member);
      },
    },
    {
      event: 'guildMemberRemove',
      async handler(context, ...args) {
        const member = args[0] as OnboardingMember | undefined;
        if (member) await handleMemberRemove(context, member);
      },
    },
  ];
}

export function normalizeOnboardingConfig(value: unknown): OnboardingConfig {
  const source = isRecord(value) ? value : {};
  const autoRoleIds = Array.isArray(source.autoRoleIds)
    ? [...new Set(source.autoRoleIds.filter(isDiscordId))].slice(0, MAX_AUTO_ROLES)
    : [];

  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    welcomeEnabled: source.welcomeEnabled === undefined ? true : source.welcomeEnabled === true,
    welcomeChannelId: nullableDiscordId(source.welcomeChannelId),
    welcomeMessage: normalizedMessage(
      source.welcomeMessage,
      '👋 {user}、{server}へようこそ！現在のメンバー数は{memberCount}人です。',
    ),
    goodbyeEnabled: source.goodbyeEnabled === undefined ? true : source.goodbyeEnabled === true,
    goodbyeChannelId: nullableDiscordId(source.goodbyeChannelId),
    goodbyeMessage: normalizedMessage(
      source.goodbyeMessage,
      '👋 {username}さんが{server}から退出しました。現在のメンバー数は{memberCount}人です。',
    ),
    autoRoleEnabled: source.autoRoleEnabled === true,
    autoRoleIds,
    mentionNewMember:
      source.mentionNewMember === undefined ? true : source.mentionNewMember === true,
  };
}

export function renderOnboardingMessage(
  template: string,
  values: OnboardingTemplateContext,
): string {
  const replacements: Record<string, string> = {
    '{user}': `<@${values.userId}>`,
    '{username}': values.username,
    '{server}': values.serverName,
    '{memberCount}': String(Math.max(0, Math.trunc(values.memberCount))),
  };
  let rendered = template;
  for (const [token, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(replacement);
  }
  return rendered.slice(0, MAX_MESSAGE_LENGTH);
}

async function handleMemberAdd(
  context: OnboardingRuntimeContext,
  member: OnboardingMember,
): Promise<void> {
  const config = normalizeOnboardingConfig(context.config);
  if (!config.enabled || member.user.bot) return;

  if (config.autoRoleEnabled && config.autoRoleIds.length > 0) {
    await assignAutoRoles(context, member, config.autoRoleIds);
  }
  if (config.welcomeEnabled && config.welcomeChannelId) {
    await sendConfiguredMessage(
      context,
      member,
      config.welcomeChannelId,
      config.welcomeMessage,
      true,
    );
  }
}

async function handleMemberRemove(
  context: OnboardingRuntimeContext,
  member: OnboardingMember,
): Promise<void> {
  const config = normalizeOnboardingConfig(context.config);
  if (!config.enabled || member.user.bot || !config.goodbyeEnabled || !config.goodbyeChannelId)
    return;
  await sendConfiguredMessage(
    context,
    member,
    config.goodbyeChannelId,
    config.goodbyeMessage,
    false,
  );
}

async function assignAutoRoles(
  context: OnboardingRuntimeContext,
  member: OnboardingMember,
  configuredRoleIds: string[],
): Promise<void> {
  const botMember = member.guild.members.me;
  if (!botMember?.permissions.has(MANAGE_ROLES_PERMISSION)) {
    context.logger.warn(
      { guildId: member.guild.id },
      'Onboarding Auto Roleに必要なManage Rolesがありません',
    );
    return;
  }

  const safeRoleIds: string[] = [];
  for (const roleId of configuredRoleIds) {
    try {
      const role = await member.guild.roles.fetch(roleId);
      if (!role || role.managed || !role.editable) {
        context.logger.warn(
          { guildId: member.guild.id, roleId },
          'Auto Roleを安全上の理由でスキップしました',
        );
        continue;
      }
      safeRoleIds.push(role.id);
    } catch (error) {
      context.logger.warn(
        { err: error, guildId: member.guild.id, roleId },
        'Auto Roleの検証に失敗しました',
      );
    }
  }
  if (safeRoleIds.length === 0) return;

  try {
    await member.roles.add(safeRoleIds);
    context.logger.info(
      { guildId: member.guild.id, userId: member.id, roleIds: safeRoleIds },
      'Onboarding Auto Roleを付与しました',
    );
  } catch (error) {
    context.logger.error(
      { err: error, guildId: member.guild.id, userId: member.id, roleIds: safeRoleIds },
      'Onboarding Auto Roleの付与に失敗しました',
    );
  }
}

async function sendConfiguredMessage(
  context: OnboardingRuntimeContext,
  member: OnboardingMember,
  channelId: string,
  template: string,
  isWelcome: boolean,
): Promise<void> {
  try {
    const channel = await member.guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      context.logger.warn(
        { guildId: member.guild.id, channelId },
        'Onboarding投稿先Channelが利用できません',
      );
      return;
    }
    const content = renderOnboardingMessage(template, {
      userId: member.user.id,
      username: member.user.username,
      serverName: member.guild.name,
      memberCount: member.guild.memberCount,
    });
    const mention = isWelcome && normalizeOnboardingConfig(context.config).mentionNewMember;
    await channel.send({
      content,
      allowedMentions: mention ? { parse: [], users: [member.user.id] } : { parse: [] },
    });
  } catch (error) {
    context.logger.error(
      { err: error, guildId: member.guild.id, channelId },
      'Onboardingメッセージの投稿に失敗しました',
    );
  }
}

async function executeWelcomeCommand(
  context: OnboardingRuntimeContext,
  interaction: OnboardingCommandInteraction,
): Promise<void> {
  const config = normalizeOnboardingConfig(context.config);
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (!interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION)) {
    await interaction.reply({
      content: 'この操作には「サーバーの管理」権限が必要です。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const values: OnboardingTemplateContext = {
    userId: interaction.user.id,
    username: interaction.user.username,
    serverName: interaction.guild.name,
    memberCount: interaction.guild.memberCount,
  };
  const welcome = renderOnboardingMessage(config.welcomeMessage, values);
  const goodbye = renderOnboardingMessage(config.goodbyeMessage, values);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'preview') {
    await interaction.reply({
      content: `**Welcome**\n${welcome}\n\n**Goodbye**\n${goodbye}`.slice(0, 1900),
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (subcommand === 'test') {
    if (!interaction.channel?.isTextBased()) {
      await interaction.reply({
        content: 'このチャンネルにはテスト投稿できません。',
        flags: EPHEMERAL_FLAG,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.channel.send({ content: welcome, allowedMentions: { parse: [] } });
    await interaction.reply({
      content: 'Welcomeメッセージをこのチャンネルへテスト投稿しました。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.reply({
    content: '未対応のサブコマンドです。',
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

function normalizedMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_MESSAGE_LENGTH) : fallback;
}

function nullableDiscordId(value: unknown): string | null {
  return isDiscordId(value) ? value : null;
}

function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
