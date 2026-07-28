import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/worker/src/daily-content.ts';
let content = await readFile(path, 'utf8');

function replaceOne(before, after) {
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one source block, received ${count}`);
  content = content.replace(before, after);
}

replaceOne(
  `  getDeliveryWithSchedule,\n`,
  `  checkDailyContentSendPermissions,\n  computeDiscordChannelPermissions,\n  getDeliveryWithSchedule,\n`,
);
replaceOne(
  `  type DailyContentConfig,\n  type DailyContentDeliveryRecord,`,
  `  type DailyContentConfig,\n  type DailyContentDeliveryRecord,\n  type DiscordPermissionMember,\n  type DiscordPermissionOverwrite,\n  type DiscordPermissionRole,`,
);
replaceOne(
  `const DISCORD_NONCE_MAX_LENGTH = 25;`,
  `const DISCORD_NONCE_MAX_LENGTH = 25;\nconst DISCORD_PERMISSION_CACHE_TTL_MS = 30_000;\nconst THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);`,
);
replaceOne(
  `type DailyContentJobData = JobData[typeof QueueNames.DAILY_CONTENT];`,
  `type DailyContentJobData = JobData[typeof QueueNames.DAILY_CONTENT];\n\ninterface DiscordChannelPayload {\n  id: string;\n  type: number;\n  guild_id?: string;\n  parent_id?: string | null;\n  permission_overwrites?: DiscordPermissionOverwrite[];\n  thread_metadata?: { archived?: boolean; locked?: boolean };\n}\n\ninterface DiscordUserPayload {\n  id: string;\n}\n\ninterface DiscordGuildMemberPayload {\n  user?: { id?: string };\n  roles?: string[];\n}\n\ninterface DiscordRolePayload {\n  id?: string;\n  permissions?: string;\n}\n\ninterface CachedGuildPermissionContext {\n  expiresAt: number;\n  member: DiscordPermissionMember;\n  roles: DiscordPermissionRole[];\n}\n\nlet discordBotUserId: string | undefined;\nconst guildPermissionCache = new Map<string, CachedGuildPermissionContext>();`,
);
replaceOne(
  `  const channel = (await channelResponse.json()) as { type?: unknown };\n  if (typeof channel.type !== 'number' || !TEXT_CHANNEL_TYPES.has(channel.type)) {\n    throw new DailyContentPublishError('DailyContentChannelNotTextBased', channelResponse.status);\n  }`,
  `  const channel = (await channelResponse.json()) as DiscordChannelPayload;\n  if (typeof channel.type !== 'number' || !TEXT_CHANNEL_TYPES.has(channel.type)) {\n    throw new DailyContentPublishError('DailyContentChannelNotTextBased', channelResponse.status);\n  }\n  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.archived) {\n    throw new DailyContentPublishError('DailyContentThreadArchived', 409);\n  }\n  await assertDiscordCanSend(input.token, channel);`,
);
replaceOne(
  `async function createDiscordError(prefix: string, response: Response): Promise<Error> {`,
  `async function assertDiscordCanSend(\n  token: string,\n  targetChannel: DiscordChannelPayload,\n): Promise<void> {\n  const isThread = THREAD_CHANNEL_TYPES.has(targetChannel.type);\n  const permissionChannel =\n    isThread && targetChannel.parent_id\n      ? await fetchDiscordJson<DiscordChannelPayload>(\n          token,\n          \`/channels/\${targetChannel.parent_id}\`,\n          'DailyContentParentChannelPreflightFailed',\n        )\n      : targetChannel;\n  const guildId = targetChannel.guild_id ?? permissionChannel.guild_id;\n  if (!guildId) {\n    throw new DailyContentPublishError('DailyContentGuildUnavailable', 400);\n  }\n\n  const botUserId = await getDiscordBotUserId(token);\n  const context = await getGuildPermissionContext(token, guildId, botUserId);\n  const permissions = computeDiscordChannelPermissions({\n    guildId,\n    member: context.member,\n    roles: context.roles,\n    overwrites: permissionChannel.permission_overwrites ?? [],\n  });\n  const check = checkDailyContentSendPermissions(permissions, isThread);\n  if (!check.allowed) {\n    throw new DailyContentPublishError(\n      \`DailyContentBotPermissionDenied:\${check.missing.join(',')}\`,\n      403,\n    );\n  }\n}\n\nasync function getDiscordBotUserId(token: string): Promise<string> {\n  if (discordBotUserId) return discordBotUserId;\n  const user = await fetchDiscordJson<DiscordUserPayload>(\n    token,\n    '/users/@me',\n    'DailyContentBotIdentityFailed',\n  );\n  if (typeof user.id !== 'string' || !user.id) {\n    throw new DailyContentPublishError('DailyContentBotIdentityInvalid', 502);\n  }\n  discordBotUserId = user.id;\n  return user.id;\n}\n\nasync function getGuildPermissionContext(\n  token: string,\n  guildId: string,\n  botUserId: string,\n): Promise<CachedGuildPermissionContext> {\n  const cached = guildPermissionCache.get(guildId);\n  if (cached && cached.expiresAt > Date.now()) return cached;\n\n  const [rolePayloads, memberPayload] = await Promise.all([\n    fetchDiscordJson<DiscordRolePayload[]>(\n      token,\n      \`/guilds/\${guildId}/roles\`,\n      'DailyContentGuildRolesPreflightFailed',\n    ),\n    fetchDiscordJson<DiscordGuildMemberPayload>(\n      token,\n      \`/guilds/\${guildId}/members/\${botUserId}\`,\n      'DailyContentBotMemberPreflightFailed',\n    ),\n  ]);\n  const roles = rolePayloads.flatMap((role) =>\n    typeof role.id === 'string' && typeof role.permissions === 'string'\n      ? [{ id: role.id, permissions: role.permissions }]\n      : [],\n  );\n  const member: DiscordPermissionMember = {\n    userId: memberPayload.user?.id ?? botUserId,\n    roleIds: Array.isArray(memberPayload.roles)\n      ? memberPayload.roles.filter((roleId): roleId is string => typeof roleId === 'string')\n      : [],\n  };\n  const context = {\n    expiresAt: Date.now() + DISCORD_PERMISSION_CACHE_TTL_MS,\n    roles,\n    member,\n  };\n  guildPermissionCache.set(guildId, context);\n  return context;\n}\n\nasync function fetchDiscordJson<T>(\n  token: string,\n  endpoint: string,\n  errorName: string,\n): Promise<T> {\n  const response = await fetch(\`${DISCORD_API_BASE_URL}\${endpoint}\`, {\n    headers: { Authorization: \`Bot \${token}\` },\n    signal: AbortSignal.timeout(10_000),\n  });\n  if (!response.ok) throw await createDiscordError(errorName, response);\n  return (await response.json()) as T;\n}\n\nasync function createDiscordError(prefix: string, response: Response): Promise<Error> {`,
);

await writeFile(path, content);
