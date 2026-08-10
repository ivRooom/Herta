import { roleManagerManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';

const EPHEMERAL_FLAG = 64;
const MANAGE_ROLES_PERMISSION = 268435456n;
const DISCORD_ID_PATTERN = /^\d+$/;
const GROUP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_GROUPS = 25;
const MAX_ROLES_PER_GROUP = 25;
const MAX_RESPONSE_LENGTH = 1900;
const ROLE_LIST_HEADER = '**選択可能なSelf Role**';
const ROLE_LIST_CONTINUATION_HEADER = '**選択可能なSelf Role（続き）**';

const roleManagerMemberLocks = new Map<string, Promise<void>>();

export type RoleManagerMode = 'single' | 'multiple';
export type RoleManagerAction = 'add' | 'remove' | 'toggle';

export interface RoleManagerGroup {
  enabled: boolean;
  id: string;
  name: string;
  description: string | null;
  mode: RoleManagerMode;
  maxSelections: number;
  roleIds: string[];
}

export interface RoleManagerConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  allowSelfRemoval: boolean;
  groups: RoleManagerGroup[];
}

export interface RoleChangePlan {
  accepted: boolean;
  changed: boolean;
  addRoleIds: string[];
  removeRoleIds: string[];
  message: string;
  groupId: string | null;
}

interface RoleManagerRoleOption {
  id: string;
}

interface RoleManagerCommandOptions {
  getSubcommand(): string;
  getRole(name: string, required?: boolean): RoleManagerRoleOption | null;
}

interface RoleManagerRole {
  id: string;
  managed: boolean;
  editable: boolean;
}

interface RoleManagerMember {
  roles: {
    cache: {
      has(roleId: string): boolean;
      keys(): IterableIterator<string>;
    };
    add(roleIds: string | string[]): Promise<unknown>;
    remove(roleIds: string | string[]): Promise<unknown>;
    set(roleIds: string[]): Promise<unknown>;
  };
}

interface RoleManagerGuild {
  id: string;
  members: {
    me: {
      permissions: {
        has(permission: bigint): boolean;
      };
    } | null;
    fetch(options: { user: string; force?: boolean }): Promise<RoleManagerMember>;
  };
  roles: {
    fetch(roleId: string): Promise<RoleManagerRole | null>;
  };
}

interface RoleManagerReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface RoleManagerEditReplyOptions {
  content: string;
  allowedMentions: { parse: [] };
}

interface RoleManagerCommandInteraction {
  guildId: string | null;
  guild: RoleManagerGuild | null;
  user: { id: string };
  options: RoleManagerCommandOptions;
  replied: boolean;
  deferred: boolean;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(options: RoleManagerEditReplyOptions): Promise<unknown>;
  reply(options: RoleManagerReplyOptions): Promise<unknown>;
  followUp(options: RoleManagerReplyOptions): Promise<unknown>;
}

type RoleManagerRuntimeContext = PluginRuntimeContext<RoleManagerConfig>;

export const roleManagerPlugin = definePlugin<RoleManagerConfig>({
  manifest: roleManagerManifest,
  provideCommands(context) {
    const command: CommandHandler<RoleManagerCommandInteraction> = {
      definition: roleManagerManifest.commands[0]!,
      async execute(interaction) {
        await executeRoleManagerCommand(context, interaction);
      },
    };
    return [command];
  },
});

export function normalizeRoleManagerConfig(value: unknown): RoleManagerConfig {
  const source = isRecord(value) ? value : {};
  const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_GROUPS) : [];
  const normalizedGroups = rawGroups.flatMap((rawGroup) => {
    const group = normalizeRoleManagerGroup(rawGroup);
    return group ? [group] : [];
  });

  const seenRoleIds = new Set<string>();
  const groups = normalizedGroups.map((group) => {
    const roleIds = group.roleIds.filter((roleId) => {
      if (seenRoleIds.has(roleId)) return false;
      seenRoleIds.add(roleId);
      return true;
    });
    return {
      ...group,
      roleIds,
      maxSelections:
        group.mode === 'single' ? 1 : Math.min(group.maxSelections, Math.max(roleIds.length, 1)),
    };
  });

  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    allowSelfRemoval:
      source.allowSelfRemoval === undefined ? true : source.allowSelfRemoval === true,
    groups,
  };
}

export function planRoleChange(
  config: RoleManagerConfig,
  currentRoleIds: Iterable<string>,
  targetRoleId: string,
  requestedAction: RoleManagerAction,
): RoleChangePlan {
  const group = config.groups.find(
    (candidate) => candidate.enabled && candidate.roleIds.includes(targetRoleId),
  );
  if (!group) {
    return rejected('このRoleはSelf Roleとして許可されていません');
  }

  const current = new Set(currentRoleIds);
  const hasTarget = current.has(targetRoleId);
  const action: Exclude<RoleManagerAction, 'toggle'> =
    requestedAction === 'toggle' ? (hasTarget ? 'remove' : 'add') : requestedAction;

  if (action === 'remove') {
    if (!config.allowSelfRemoval) {
      return rejected('このサーバーではSelf Roleの自己解除が無効です', group.id);
    }
    if (!hasTarget) {
      return unchanged('このRoleは現在付与されていません', group.id);
    }
    return accepted([], [targetRoleId], 'Self Roleを解除します', group.id);
  }

  if (hasTarget) {
    return unchanged('このRoleはすでに付与されています', group.id);
  }

  const selectedInGroup = group.roleIds.filter((roleId) => current.has(roleId));
  if (group.mode === 'single') {
    return accepted(
      [targetRoleId],
      selectedInGroup,
      selectedInGroup.length > 0 ? '同じグループのRoleを切り替えます' : 'Self Roleを追加します',
      group.id,
    );
  }

  if (selectedInGroup.length >= group.maxSelections) {
    return rejected(`「${group.name}」では最大${group.maxSelections}個まで選択できます`, group.id);
  }

  return accepted([targetRoleId], [], 'Self Roleを追加します', group.id);
}

export function buildRoleManagerFinalRoleIds(
  currentRoleIds: Iterable<string>,
  guildId: string,
  plan: RoleChangePlan,
): string[] {
  const removeRoleIds = new Set(plan.removeRoleIds);
  const finalRoleIds = new Set(
    [...currentRoleIds].filter((roleId) => roleId !== guildId && !removeRoleIds.has(roleId)),
  );
  for (const roleId of plan.addRoleIds) finalRoleIds.add(roleId);
  return [...finalRoleIds];
}

export async function withRoleManagerMemberLock<T>(
  guildId: string,
  userId: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = `${guildId}:${userId}`;
  const previous = roleManagerMemberLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  roleManagerMemberLocks.set(key, tail);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (roleManagerMemberLocks.get(key) === tail) roleManagerMemberLocks.delete(key);
  }
}

export function formatRoleManagerListPages(config: RoleManagerConfig): string[] {
  const groups = config.groups.filter((group) => group.enabled && group.roleIds.length > 0);
  if (groups.length === 0) {
    return ['Self Roleはまだ設定されていません。Herta StudioからRoleグループを追加してください。'];
  }

  const sections = groups.map((group) => {
    const modeLabel =
      group.mode === 'single' ? '1つだけ選択' : `最大${group.maxSelections}個まで選択`;
    const lines = [`**${group.name}** — ${modeLabel}`];
    if (group.description) lines.push(group.description);
    lines.push(group.roleIds.map((roleId) => `<@&${roleId}>`).join('  '));
    return lines.join('\n');
  });

  const pages: string[] = [];
  let currentPage = ROLE_LIST_HEADER;

  for (const section of sections) {
    const nextPage = `${currentPage}\n\n${section}`;
    if (nextPage.length <= MAX_RESPONSE_LENGTH) {
      currentPage = nextPage;
      continue;
    }

    pages.push(currentPage);
    currentPage = `${ROLE_LIST_CONTINUATION_HEADER}\n\n${section}`;
  }

  pages.push(currentPage);
  return pages;
}

async function executeRoleManagerCommand(
  context: RoleManagerRuntimeContext,
  interaction: RoleManagerCommandInteraction,
): Promise<void> {
  const config = normalizeRoleManagerConfig(context.config);
  if (!config.enabled) {
    await respond(interaction, 'Role Managerは設定で無効になっています', true);
    return;
  }

  if (!interaction.guildId || !interaction.guild) {
    await respond(interaction, 'このコマンドはサーバー内でのみ利用できます', true);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    const pages = formatRoleManagerListPages(config);
    await respond(interaction, pages[0]!, config.ephemeralResponses);
    for (const page of pages.slice(1)) {
      await followUp(interaction, page, config.ephemeralResponses);
    }
    return;
  }

  if (subcommand !== 'add' && subcommand !== 'remove' && subcommand !== 'toggle') {
    await respond(interaction, '指定されたサブコマンドは利用できません', true);
    return;
  }

  const selectedRole = interaction.options.getRole('role', true);
  if (!selectedRole || !DISCORD_ID_PATTERN.test(selectedRole.id)) {
    await respond(interaction, 'Roleを選択してください', true);
    return;
  }

  try {
    await interaction.deferReply(config.ephemeralResponses ? { flags: EPHEMERAL_FLAG } : undefined);

    const result = await withRoleManagerMemberLock(
      interaction.guildId,
      interaction.user.id,
      async () => {
        const member = await interaction.guild!.members.fetch({
          user: interaction.user.id,
          force: true,
        });
        const configuredRoleIds = config.groups.flatMap((group) => group.roleIds);
        const currentRoleIds = configuredRoleIds.filter((roleId) => member.roles.cache.has(roleId));
        const plan = planRoleChange(config, currentRoleIds, selectedRole.id, subcommand);

        if (!plan.accepted || !plan.changed) return { message: plan.message, plan: null };

        if (!interaction.guild!.members.me?.permissions.has(MANAGE_ROLES_PERMISSION)) {
          return {
            message:
              'Herta Botに「ロールの管理」権限がありません。サーバー管理者へ確認してください。',
            plan: null,
          };
        }

        const affectedRoleIds = [...new Set([...plan.removeRoleIds, ...plan.addRoleIds])];
        for (const roleId of affectedRoleIds) {
          const role = await interaction.guild!.roles.fetch(roleId);
          if (!role) {
            return {
              message: `Role ${roleId} が見つかりません。Studio設定を確認してください。`,
              plan: null,
            };
          }
          if (role.id === interaction.guild!.id || role.managed || !role.editable) {
            return {
              message:
                'このRoleはHerta Botから安全に編集できません。Botより下へRoleを移動し、Managed Roleではないことを確認してください。',
              plan: null,
            };
          }
        }

        if (plan.removeRoleIds.length > 0 && plan.addRoleIds.length > 0) {
          const finalRoleIds = buildRoleManagerFinalRoleIds(
            member.roles.cache.keys(),
            interaction.guild!.id,
            plan,
          );
          await member.roles.set(finalRoleIds);
        } else if (plan.removeRoleIds.length > 0) {
          await member.roles.remove(plan.removeRoleIds);
        } else if (plan.addRoleIds.length > 0) {
          await member.roles.add(plan.addRoleIds);
        }

        return { message: formatRoleChangeSuccess(plan), plan };
      },
    );

    if (result.plan) {
      context.logger.info(
        {
          guildId: interaction.guildId,
          userId: interaction.user.id,
          groupId: result.plan.groupId,
          requestedAction: subcommand,
          addedRoleIds: result.plan.addRoleIds,
          removedRoleIds: result.plan.removeRoleIds,
        },
        'Role ManagerでSelf Roleを更新しました',
      );
    }

    await respond(interaction, result.message, config.ephemeralResponses);
  } catch (error) {
    context.logger.warn(
      {
        err: error,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        roleId: selectedRole.id,
        requestedAction: subcommand,
      },
      'Role ManagerのSelf Role更新に失敗しました',
    );
    await respond(
      interaction,
      'Self Roleの更新に失敗しました。BotのRole順と「ロールの管理」権限を確認してください。',
      true,
    );
  }
}

function normalizeRoleManagerGroup(value: unknown): RoleManagerGroup | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!GROUP_ID_PATTERN.test(id)) return null;

  const name = normalizeText(value.name, 80);
  if (!name) return null;

  const mode: RoleManagerMode = value.mode === 'single' ? 'single' : 'multiple';
  const roleIds = normalizeDiscordIdArray(value.roleIds, MAX_ROLES_PER_GROUP);

  return {
    enabled: value.enabled === undefined ? true : value.enabled === true,
    id,
    name,
    description: normalizeText(value.description, 200),
    mode,
    maxSelections: mode === 'single' ? 1 : clampInteger(value.maxSelections, 25, 1, 25),
    roleIds,
  };
}

function normalizeDiscordIdArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => DISCORD_ID_PATTERN.test(item)),
    ),
  ].slice(0, maxItems);
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function accepted(
  addRoleIds: string[],
  removeRoleIds: string[],
  message: string,
  groupId: string,
): RoleChangePlan {
  return {
    accepted: true,
    changed: addRoleIds.length > 0 || removeRoleIds.length > 0,
    addRoleIds,
    removeRoleIds,
    message,
    groupId,
  };
}

function unchanged(message: string, groupId: string): RoleChangePlan {
  return {
    accepted: true,
    changed: false,
    addRoleIds: [],
    removeRoleIds: [],
    message,
    groupId,
  };
}

function rejected(message: string, groupId: string | null = null): RoleChangePlan {
  return {
    accepted: false,
    changed: false,
    addRoleIds: [],
    removeRoleIds: [],
    message,
    groupId,
  };
}

function formatRoleChangeSuccess(plan: RoleChangePlan): string {
  const lines: string[] = [];
  if (plan.addRoleIds.length > 0) {
    lines.push(`追加: ${plan.addRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`);
  }
  if (plan.removeRoleIds.length > 0) {
    lines.push(`解除: ${plan.removeRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`);
  }
  return truncate(`Self Roleを更新しました\n${lines.join('\n')}`, MAX_RESPONSE_LENGTH);
}

async function respond(
  interaction: RoleManagerCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  const safeContent = truncate(content, MAX_RESPONSE_LENGTH);
  if (interaction.deferred) {
    await interaction.editReply({
      content: safeContent,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const options = createReplyOptions(safeContent, ephemeral);
  if (interaction.replied) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

async function followUp(
  interaction: RoleManagerCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  await interaction.followUp(createReplyOptions(truncate(content, MAX_RESPONSE_LENGTH), ephemeral));
}

function createReplyOptions(content: string, ephemeral: boolean): RoleManagerReplyOptions {
  return {
    content,
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default roleManagerPlugin;
