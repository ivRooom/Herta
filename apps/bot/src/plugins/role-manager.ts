import { roleManagerManifest } from '@herta/plugin-catalog';
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
const GROUP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_GROUPS = 25;
const MAX_ROLES_PER_GROUP = 25;
const MAX_RESPONSE_LENGTH = 1900;
const ROLE_LIST_HEADER = '**選択可能なSelf Role**';
const ROLE_LIST_CONTINUATION_HEADER = '**選択可能なSelf Role（続き）**';
const PANEL_CUSTOM_ID_PREFIX = 'herta:role:v2:';

const roleManagerMemberLocks = new Map<string, Promise<void>>();

export type RoleManagerMode = 'single' | 'multiple';
export type RoleManagerAction = 'add' | 'remove' | 'toggle';
export type RoleManagerPanelStyle = 'select' | 'buttons';

export interface RoleManagerGroup {
  enabled: boolean;
  id: string;
  name: string;
  description: string | null;
  mode: RoleManagerMode;
  maxSelections: number;
  panelStyle: RoleManagerPanelStyle;
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

export interface RolePanelRole {
  id: string;
  name: string;
}

export interface RolePanelMessage {
  content: string;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: [] };
}

interface RoleManagerRoleOption {
  id: string;
}

interface RoleManagerCommandOptions {
  getSubcommand(): string;
  getRole(name: string, required?: boolean): RoleManagerRoleOption | null;
  getString(name: string, required?: boolean): string | null;
}

interface RoleManagerRole {
  id: string;
  name: string;
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

interface RoleManagerTextChannel {
  isTextBased(): boolean;
  send(options: RolePanelMessage): Promise<unknown>;
}

interface RoleManagerPermissions {
  has(permission: bigint): boolean;
}

interface RoleManagerCommandInteraction {
  guildId: string | null;
  guild: RoleManagerGuild | null;
  channel: RoleManagerTextChannel | null;
  memberPermissions: RoleManagerPermissions | null;
  user: { id: string };
  options: RoleManagerCommandOptions;
  replied: boolean;
  deferred: boolean;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(options: RoleManagerEditReplyOptions): Promise<unknown>;
  reply(options: RoleManagerReplyOptions): Promise<unknown>;
  followUp(options: RoleManagerReplyOptions): Promise<unknown>;
}

interface RoleManagerComponentInteraction {
  guildId: string | null;
  guild: RoleManagerGuild | null;
  user: { id: string };
  customId?: string;
  values?: string[];
  replied: boolean;
  deferred: boolean;
  isButton?(): boolean;
  isStringSelectMenu?(): boolean;
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
  provideEvents() {
    return createRoleManagerEvents() as PluginEventHandler<RoleManagerConfig>[];
  },
});

function createRoleManagerEvents(): PluginEventHandler<RoleManagerConfig>[] {
  return [
    {
      event: 'interactionCreate',
      async handler(context, ...args) {
        const interaction = args[0] as RoleManagerComponentInteraction | undefined;
        await handleRoleManagerComponent(context, interaction);
      },
    },
  ];
}

export function normalizeRoleManagerConfig(value: unknown): RoleManagerConfig {
  const source = isRecord(value) ? value : {};
  const rawGroups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_GROUPS) : [];
  const normalizedGroups = rawGroups.flatMap((rawGroup) => {
    const group = normalizeRoleManagerGroup(rawGroup);
    return group ? [group] : [];
  });

  const seenGroupIds = new Set<string>();
  const seenRoleIds = new Set<string>();
  const groups = normalizedGroups.flatMap((group) => {
    if (seenGroupIds.has(group.id)) return [];
    seenGroupIds.add(group.id);
    const roleIds = group.roleIds.filter((roleId) => {
      if (seenRoleIds.has(roleId)) return false;
      seenRoleIds.add(roleId);
      return true;
    });
    return [
      {
        ...group,
        roleIds,
        maxSelections:
          group.mode === 'single' ? 1 : Math.min(group.maxSelections, Math.max(roleIds.length, 1)),
      },
    ];
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
  if (!group) return rejected('このRoleはSelf Roleとして許可されていません');

  const current = new Set(currentRoleIds);
  const hasTarget = current.has(targetRoleId);
  const action: Exclude<RoleManagerAction, 'toggle'> =
    requestedAction === 'toggle' ? (hasTarget ? 'remove' : 'add') : requestedAction;

  if (action === 'remove') {
    if (!config.allowSelfRemoval) {
      return rejected('このサーバーではSelf Roleの自己解除が無効です', group.id);
    }
    if (!hasTarget) return unchanged('このRoleは現在付与されていません', group.id);
    return accepted([], [targetRoleId], 'Self Roleを解除します', group.id);
  }

  if (hasTarget) return unchanged('このRoleはすでに付与されています', group.id);

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

export function planRoleGroupSelection(
  config: RoleManagerConfig,
  groupId: string,
  currentRoleIds: Iterable<string>,
  desiredRoleIds: Iterable<string>,
): RoleChangePlan {
  const group = config.groups.find((candidate) => candidate.enabled && candidate.id === groupId);
  if (!group) return rejected('このRoleグループは現在利用できません', groupId);

  const desired = [...new Set(desiredRoleIds)];
  if (desired.some((roleId) => !group.roleIds.includes(roleId))) {
    return rejected('許可されていないRoleが選択されました', group.id);
  }
  const maxSelections = group.mode === 'single' ? 1 : group.maxSelections;
  if (desired.length > maxSelections) {
    return rejected(`「${group.name}」では最大${maxSelections}個まで選択できます`, group.id);
  }

  const currentRoleIdSet = new Set(currentRoleIds);
  const current = new Set(group.roleIds.filter((roleId) => currentRoleIdSet.has(roleId)));
  const desiredSet = new Set(desired);
  const addRoleIds = desired.filter((roleId) => !current.has(roleId));
  const removeRoleIds = [...current].filter((roleId) => !desiredSet.has(roleId));
  if (addRoleIds.length === 0 && removeRoleIds.length === 0) {
    return unchanged('Self Roleの選択に変更はありません', group.id);
  }
  if (!config.allowSelfRemoval && addRoleIds.length === 0 && removeRoleIds.length > 0) {
    return rejected('このサーバーではSelf Roleの自己解除が無効です', group.id);
  }
  return accepted(addRoleIds, removeRoleIds, 'Role Panelの選択を反映します', group.id);
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

export function buildRolePanelMessage(
  group: RoleManagerGroup,
  roles: RolePanelRole[],
): RolePanelMessage {
  const description = group.description ? `\n${group.description}` : '';
  const modeLabel = group.mode === 'single' ? '1つ選択' : `最大${group.maxSelections}個まで選択`;
  const content = `**${group.name}**\n${modeLabel}${description}`;

  if (group.panelStyle === 'buttons') {
    const rows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < roles.length; index += 5) {
      rows.push({
        type: 1,
        components: roles.slice(index, index + 5).map((role) => ({
          type: 2,
          style: 2,
          custom_id: `${PANEL_CUSTOM_ID_PREFIX}toggle:${group.id}:${role.id}`,
          label: truncate(role.name, 80),
        })),
      });
    }
    return { content, components: rows, allowedMentions: { parse: [] } };
  }

  const maxValues = Math.min(group.mode === 'single' ? 1 : group.maxSelections, roles.length);
  return {
    content,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${PANEL_CUSTOM_ID_PREFIX}select:${group.id}`,
            placeholder: `${group.name}を選択`,
            min_values: 1,
            max_values: maxValues,
            options: roles.map((role) => ({
              label: truncate(role.name, 100),
              value: role.id,
            })),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            custom_id: `${PANEL_CUSTOM_ID_PREFIX}clear:${group.id}`,
            label: '選択を解除',
          },
        ],
      },
    ],
    allowedMentions: { parse: [] },
  };
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
    const panelLabel = group.panelStyle === 'buttons' ? 'Button Panel' : 'Select Menu Panel';
    const lines = [`**${group.name}** — ${modeLabel} / ${panelLabel}`];
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
    for (const page of pages.slice(1)) await followUp(interaction, page, config.ephemeralResponses);
    return;
  }
  if (subcommand === 'panel') {
    await executeRolePanelCommand(context, interaction, config);
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
    const result = await applyRoleManagerPlan(
      context,
      interaction.guild,
      interaction.user.id,
      () => {
        const configuredRoleIds = config.groups.flatMap((group) => group.roleIds);
        return async (member: RoleManagerMember) => {
          const currentRoleIds = configuredRoleIds.filter((roleId) =>
            member.roles.cache.has(roleId),
          );
          return planRoleChange(config, currentRoleIds, selectedRole.id, subcommand);
        };
      },
    );
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

async function executeRolePanelCommand(
  context: RoleManagerRuntimeContext,
  interaction: RoleManagerCommandInteraction,
  config: RoleManagerConfig,
): Promise<void> {
  if (!interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION)) {
    await respond(interaction, 'Role Panelの作成には「サーバーの管理」権限が必要です', true);
    return;
  }
  const groupId = interaction.options.getString('group', true)?.trim() ?? '';
  const group = config.groups.find((candidate) => candidate.enabled && candidate.id === groupId);
  if (!group || group.roleIds.length === 0) {
    await respond(
      interaction,
      '指定したRoleグループが見つからないか、Roleが設定されていません',
      true,
    );
    return;
  }
  if (!interaction.channel?.isTextBased()) {
    await respond(interaction, 'このChannelにはRole Panelを投稿できません', true);
    return;
  }

  await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  const roles: RolePanelRole[] = [];
  for (const roleId of group.roleIds) {
    const role = await interaction.guild!.roles.fetch(roleId);
    if (!role) {
      await respond(
        interaction,
        `Role ${roleId} が見つかりません。Studio設定を確認してください。`,
        true,
      );
      return;
    }
    if (role.id === interaction.guild!.id || role.managed || !role.editable) {
      await respond(
        interaction,
        `「${role.name}」はHertaから編集できません。Botより下へRoleを移動してください。`,
        true,
      );
      return;
    }
    roles.push({ id: role.id, name: role.name });
  }

  await interaction.channel.send(buildRolePanelMessage(group, roles));
  context.logger.info(
    { guildId: interaction.guildId, userId: interaction.user.id, groupId: group.id },
    'Role ManagerのRole Panelを投稿しました',
  );
  await respond(interaction, `「${group.name}」のRole Panelを投稿しました`, true);
}

async function handleRoleManagerComponent(
  context: RoleManagerRuntimeContext,
  interaction: RoleManagerComponentInteraction | undefined,
): Promise<void> {
  if (!interaction?.customId?.startsWith(PANEL_CUSTOM_ID_PREFIX)) return;
  if (!interaction.guildId || !interaction.guild) return;
  const config = normalizeRoleManagerConfig(context.config);
  if (!config.enabled) {
    await respondComponent(interaction, 'Role Managerは現在無効です');
    return;
  }

  const payload = parseRolePanelCustomId(interaction.customId);
  if (!payload) {
    await respondComponent(interaction, 'このRole Panelは利用できません');
    return;
  }
  const group = config.groups.find(
    (candidate) => candidate.enabled && candidate.id === payload.groupId,
  );
  if (!group) {
    await respondComponent(interaction, 'このRole Panelの設定は削除または無効化されています');
    return;
  }

  await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  try {
    const result = await applyRoleManagerPlan(
      context,
      interaction.guild,
      interaction.user.id,
      () => {
        return async (member: RoleManagerMember) => {
          const currentRoleIds = group.roleIds.filter((roleId) => member.roles.cache.has(roleId));
          if (payload.action === 'toggle') {
            if (!payload.roleId || !group.roleIds.includes(payload.roleId)) {
              return rejected('このRoleは現在選択できません', group.id);
            }
            return planRoleChange(config, currentRoleIds, payload.roleId, 'toggle');
          }
          const desiredRoleIds =
            payload.action === 'clear'
              ? []
              : (interaction.values ?? []).filter((roleId) => DISCORD_ID_PATTERN.test(roleId));
          return planRoleGroupSelection(config, group.id, currentRoleIds, desiredRoleIds);
        };
      },
    );
    await respondComponent(interaction, result.message);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: interaction.guildId, userId: interaction.user.id, groupId: group.id },
      'Role PanelからのSelf Role更新に失敗しました',
    );
    await respondComponent(
      interaction,
      'Self Roleの更新に失敗しました。BotのRole順と権限を管理者へ確認してください。',
    );
  }
}

async function applyRoleManagerPlan(
  context: RoleManagerRuntimeContext,
  guild: RoleManagerGuild,
  userId: string,
  plannerFactory: () => (member: RoleManagerMember) => Promise<RoleChangePlan> | RoleChangePlan,
): Promise<{ message: string; plan: RoleChangePlan | null }> {
  return withRoleManagerMemberLock(guild.id, userId, async () => {
    const member = await guild.members.fetch({ user: userId, force: true });
    const plan = await plannerFactory()(member);
    if (!plan.accepted || !plan.changed) return { message: plan.message, plan: null };

    if (!guild.members.me?.permissions.has(MANAGE_ROLES_PERMISSION)) {
      return {
        message: 'Herta Botに「ロールの管理」権限がありません。サーバー管理者へ確認してください。',
        plan: null,
      };
    }

    const affectedRoleIds = [...new Set([...plan.removeRoleIds, ...plan.addRoleIds])];
    for (const roleId of affectedRoleIds) {
      const role = await guild.roles.fetch(roleId);
      if (!role)
        return {
          message: `Role ${roleId} が見つかりません。Studio設定を確認してください。`,
          plan: null,
        };
      if (role.id === guild.id || role.managed || !role.editable) {
        return {
          message:
            'このRoleはHerta Botから安全に編集できません。Botより下へRoleを移動し、Managed Roleではないことを確認してください。',
          plan: null,
        };
      }
    }

    if (plan.removeRoleIds.length > 0 && plan.addRoleIds.length > 0) {
      await member.roles.set(
        buildRoleManagerFinalRoleIds(member.roles.cache.keys(), guild.id, plan),
      );
    } else if (plan.removeRoleIds.length > 0) {
      await member.roles.remove(plan.removeRoleIds);
    } else if (plan.addRoleIds.length > 0) {
      await member.roles.add(plan.addRoleIds);
    }

    context.logger.info(
      {
        guildId: guild.id,
        userId,
        groupId: plan.groupId,
        addedRoleIds: plan.addRoleIds,
        removedRoleIds: plan.removeRoleIds,
      },
      'Role ManagerでSelf Roleを更新しました',
    );
    return { message: formatRoleChangeSuccess(plan), plan };
  });
}

export function parseRolePanelCustomId(
  customId: string,
):
  | { action: 'select' | 'clear'; groupId: string; roleId: null }
  | { action: 'toggle'; groupId: string; roleId: string }
  | null {
  if (!customId.startsWith(PANEL_CUSTOM_ID_PREFIX)) return null;
  const parts = customId.slice(PANEL_CUSTOM_ID_PREFIX.length).split(':');
  const action = parts[0];
  const groupId = parts[1] ?? '';
  if (!GROUP_ID_PATTERN.test(groupId)) return null;
  if ((action === 'select' || action === 'clear') && parts.length === 2) {
    return { action, groupId, roleId: null };
  }
  const roleId = parts[2] ?? '';
  if (action === 'toggle' && parts.length === 3 && DISCORD_ID_PATTERN.test(roleId)) {
    return { action, groupId, roleId };
  }
  return null;
}

function normalizeRoleManagerGroup(value: unknown): RoleManagerGroup | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!GROUP_ID_PATTERN.test(id)) return null;
  const name = normalizeText(value.name, 80);
  if (!name) return null;
  const mode: RoleManagerMode = value.mode === 'single' ? 'single' : 'multiple';
  const panelStyle: RoleManagerPanelStyle = value.panelStyle === 'buttons' ? 'buttons' : 'select';
  const roleIds = normalizeDiscordIdArray(value.roleIds, MAX_ROLES_PER_GROUP);
  return {
    enabled: value.enabled === undefined ? true : value.enabled === true,
    id,
    name,
    description: normalizeText(value.description, 200),
    mode,
    maxSelections: mode === 'single' ? 1 : clampInteger(value.maxSelections, 25, 1, 25),
    panelStyle,
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
  return normalized ? normalized.slice(0, maxLength) : null;
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
  return { accepted: true, changed: false, addRoleIds: [], removeRoleIds: [], message, groupId };
}

function rejected(message: string, groupId: string | null = null): RoleChangePlan {
  return { accepted: false, changed: false, addRoleIds: [], removeRoleIds: [], message, groupId };
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
    await interaction.editReply({ content: safeContent, allowedMentions: { parse: [] } });
    return;
  }
  const options = createReplyOptions(safeContent, ephemeral);
  if (interaction.replied) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

async function respondComponent(
  interaction: RoleManagerComponentInteraction,
  content: string,
): Promise<void> {
  const safeContent = truncate(content, MAX_RESPONSE_LENGTH);
  if (interaction.deferred) {
    await interaction.editReply({ content: safeContent, allowedMentions: { parse: [] } });
    return;
  }
  const options = createReplyOptions(safeContent, true);
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
