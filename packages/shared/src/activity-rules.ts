const DISCORD_ID_PATTERN = /^\d+$/;
const DEFAULT_COMMAND_PREFIXES = ['/', '!'] as const;

/**
 * ゲーム集計の既定の除外リスト。ゲーム本体ではなくコンパニオン/トラッカー等の
 * 周辺アプリが「プレイ中」として長時間表示され、統計を歪めることが実測で
 * 確認されたものだけを入れる(S0実測: Valorant Tracker App が132.5hで全体6位)。
 * Guild設定で excludedGameActivityNames を明示した場合はそちらが優先され、
 * 空配列を明示すると除外なしになる。
 */
export const DEFAULT_EXCLUDED_GAME_ACTIVITY_NAMES: readonly string[] = ['Valorant Tracker App'];

/** Discord ActivityType のうちゲーム集計の対象にする種別(数値はdiscord.jsのActivityTypeと一致)。 */
export const GAME_ACTIVITY_TYPES = {
  /** ActivityType.Playing */
  playing: 0,
  /** ActivityType.Competing */
  competing: 5,
} as const;

/**
 * ゲーム種別の優先順位。同時に複数ある場合はこの順で1件だけを計測対象にする。
 * Playing を Competing より優先するのは、従来の「Playing先頭1件」という
 * 挙動を変えずに Competing をフォールバックとして足すため。
 */
const GAME_ACTIVITY_TYPE_PRIORITY: readonly number[] = [
  GAME_ACTIVITY_TYPES.playing,
  GAME_ACTIVITY_TYPES.competing,
];

export interface GameActivityLike {
  type: number;
  name?: string | null;
  /**
   * Discordのapplication_id(Rich Presence連携・detectable登録ゲームでは付くが、
   * 未登録の検出ではnullになり得る)。名寄せ(S7)の統合キーに使う。
   */
  applicationId?: string | null;
}

/** 計測対象として選ばれたゲーム。applicationIdはsnowflakeでない値を弾いた後の値。 */
export interface PrimaryGameActivity {
  name: string;
  applicationId: string | null;
}

/** 除外判定は前後空白を除いた完全一致(大文字小文字は区別しない)。 */
export function isExcludedGameActivityName(
  activityName: string,
  excludedGameActivityNames: readonly string[],
): boolean {
  const normalized = activityName.trim().toLowerCase();
  if (!normalized) return false;
  return excludedGameActivityNames.some((excluded) => excluded.trim().toLowerCase() === normalized);
}

/** application_idの除外判定は完全一致のみ(null・空は常に対象外=除外しない)。 */
export function isExcludedGameActivityId(
  applicationId: string | null | undefined,
  excludedGameApplicationIds: readonly string[],
): boolean {
  if (!applicationId) return false;
  return excludedGameApplicationIds.includes(applicationId);
}

/**
 * activityのapplicationIdをsnowflake文字列へ正規化する。数値文字列でない値
 * (未設定・null・型崩れ)はnullとして扱い、名寄せは名前キーへフォールバックする。
 */
export function normalizeGameApplicationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * セッション同一性のキー。applicationIdがある場合はidを優先し、同じアプリの
 * 表示名ゆれ(ローカライズ名・改名)ではセッションを切り替えない。idが無い
 * 場合は従来どおり名前で判定する。
 */
export function gameActivityIdentityKey(activity: PrimaryGameActivity): string {
  return activity.applicationId ? `app:${activity.applicationId}` : `name:${activity.name}`;
}

/**
 * presenceのactivities全件から計測対象のゲームを1つだけ選ぶ。
 *
 * community_game_sessions は PK(guildId, userId) で進行中セッションを1行しか
 * 持てないため、複数ゲームの同時計測(複数セッション化)はせず、優先順位で
 * 1件に絞る。種別内ではactivitiesの並び順(従来どおり先頭優先)を維持し、
 * 除外リスト(名前・application_id)に一致するものはスキップして次点の候補へ進む。
 */
export function selectPrimaryGameActivity(
  activities: readonly GameActivityLike[] | null | undefined,
  excludedGameActivityNames: readonly string[],
  excludedGameApplicationIds: readonly string[] = [],
): PrimaryGameActivity | null {
  if (!activities?.length) return null;
  for (const type of GAME_ACTIVITY_TYPE_PRIORITY) {
    for (const activity of activities) {
      if (activity.type !== type) continue;
      const name = activity.name?.trim() ?? '';
      if (!name) continue;
      if (isExcludedGameActivityName(name, excludedGameActivityNames)) continue;
      const applicationId = normalizeGameApplicationId(activity.applicationId);
      if (isExcludedGameActivityId(applicationId, excludedGameApplicationIds)) continue;
      return { name, applicationId };
    }
  }
  return null;
}

export function selectPrimaryGameActivityName(
  activities: readonly GameActivityLike[] | null | undefined,
  excludedGameActivityNames: readonly string[],
): string | null {
  return selectPrimaryGameActivity(activities, excludedGameActivityNames)?.name ?? null;
}

export interface ActivityRulesConfig {
  excludedTextChannelIds: string[];
  excludedVoiceChannelIds: string[];
  excludedRoleIds: string[];
  messageCooldownSeconds: number;
  minimumMessageLength: number;
  excludeCommandMessages: boolean;
  commandPrefixes: string[];
  applyMessageRulesToXp: boolean;
  countReactionsGiven: boolean;
  countReactionsReceived: boolean;
  countSelfMutedVoice: boolean;
  countServerMutedVoice: boolean;
  countSelfDeafenedVoice: boolean;
  countServerDeafenedVoice: boolean;
  countOnlinePresence: boolean;
  countGamePresence: boolean;
  excludedGameActivityNames: string[];
  excludedGameApplicationIds: string[];
  countCommandPoints: boolean;
  messagePointsPerMessage: number;
  reactionPointsPerReaction: number;
  voicePointsPer10Minutes: number;
  onlinePointsPerHour: number;
  onlinePointsDailyCap: number;
  gamePointsPerHour: number;
  gamePointsDailyCap: number;
  achievementPoints: number;
  commandPointsPerUse: number;
  commandPointsDailyCap: number;
  countLfgPoints: boolean;
  lfgPointsPerJoin: number;
  lfgPointsDailyCap: number;
  countTeamSplitPoints: boolean;
  teamSplitPointsPerJoin: number;
  teamSplitPointsDailyCap: number;
  countPollPoints: boolean;
  pollPointsPerVote: number;
  pollPointsDailyCap: number;
}

/** Community Pointsの各加点単価・1日上限。getCommunityPointsLeaderboard()等へそのまま渡す。 */
export interface CommunityPointsRates {
  messagePointsPerMessage: number;
  reactionPointsPerReaction: number;
  voicePointsPer10Minutes: number;
  onlinePointsPerHour: number;
  onlinePointsDailyCap: number;
  gamePointsPerHour: number;
  gamePointsDailyCap: number;
  achievementPoints: number;
  commandPointsPerUse: number;
  commandPointsDailyCap: number;
  lfgPointsPerJoin: number;
  lfgPointsDailyCap: number;
  teamSplitPointsPerJoin: number;
  teamSplitPointsDailyCap: number;
  pollPointsPerVote: number;
  pollPointsDailyCap: number;
}

export function communityPointsRatesFromConfig(config: ActivityRulesConfig): CommunityPointsRates {
  return {
    messagePointsPerMessage: config.messagePointsPerMessage,
    reactionPointsPerReaction: config.reactionPointsPerReaction,
    voicePointsPer10Minutes: config.voicePointsPer10Minutes,
    onlinePointsPerHour: config.countOnlinePresence ? config.onlinePointsPerHour : 0,
    onlinePointsDailyCap: config.onlinePointsDailyCap,
    gamePointsPerHour: config.countGamePresence ? config.gamePointsPerHour : 0,
    gamePointsDailyCap: config.gamePointsDailyCap,
    achievementPoints: config.achievementPoints,
    commandPointsPerUse: config.countCommandPoints ? config.commandPointsPerUse : 0,
    commandPointsDailyCap: config.commandPointsDailyCap,
    lfgPointsPerJoin: config.countLfgPoints ? config.lfgPointsPerJoin : 0,
    lfgPointsDailyCap: config.lfgPointsDailyCap,
    teamSplitPointsPerJoin: config.countTeamSplitPoints ? config.teamSplitPointsPerJoin : 0,
    teamSplitPointsDailyCap: config.teamSplitPointsDailyCap,
    pollPointsPerVote: config.countPollPoints ? config.pollPointsPerVote : 0,
    pollPointsDailyCap: config.pollPointsDailyCap,
  };
}

export interface MessageActivityCandidate {
  channelId: string;
  roleIds?: readonly string[];
  contentLength?: number;
  content?: string;
  contentAvailable: boolean;
}

export interface VoiceActivityCandidate {
  channelId: string | null;
  roleIds?: readonly string[];
  selfMute?: boolean | null;
  serverMute?: boolean | null;
  selfDeaf?: boolean | null;
  serverDeaf?: boolean | null;
}

export type MessageActivityBlockingReason =
  'excluded_text_channel' | 'excluded_role' | 'command_prefix' | 'minimum_message_length';

export type MessageActivityNotice =
  'command_check_skipped_without_content' | 'length_check_skipped_without_content';

export interface MessageActivityEvaluation {
  counted: boolean;
  blockingReason: MessageActivityBlockingReason | null;
  matchedCommandPrefix: string | null;
  notices: MessageActivityNotice[];
}

export function normalizeActivityRulesConfig(value: unknown): ActivityRulesConfig {
  const source = isRecord(value) ? value : {};
  return {
    excludedTextChannelIds: normalizedIds(source.excludedTextChannelIds, 50),
    excludedVoiceChannelIds: normalizedIds(source.excludedVoiceChannelIds, 50),
    excludedRoleIds: normalizedIds(source.excludedRoleIds, 50),
    messageCooldownSeconds: clamp(toInteger(source.messageCooldownSeconds, 0), 0, 300),
    minimumMessageLength: clamp(toInteger(source.minimumMessageLength, 0), 0, 200),
    excludeCommandMessages: source.excludeCommandMessages === true,
    commandPrefixes: normalizedCommandPrefixes(source.commandPrefixes),
    applyMessageRulesToXp: source.applyMessageRulesToXp === true,
    countReactionsGiven:
      source.countReactionsGiven === undefined ? true : source.countReactionsGiven === true,
    countReactionsReceived:
      source.countReactionsReceived === undefined ? true : source.countReactionsReceived === true,
    countSelfMutedVoice:
      source.countSelfMutedVoice === undefined ? true : source.countSelfMutedVoice === true,
    countServerMutedVoice:
      source.countServerMutedVoice === undefined ? true : source.countServerMutedVoice === true,
    countSelfDeafenedVoice:
      source.countSelfDeafenedVoice === undefined ? true : source.countSelfDeafenedVoice === true,
    countServerDeafenedVoice:
      source.countServerDeafenedVoice === undefined
        ? true
        : source.countServerDeafenedVoice === true,
    countOnlinePresence:
      source.countOnlinePresence === undefined ? true : source.countOnlinePresence === true,
    countGamePresence:
      source.countGamePresence === undefined ? true : source.countGamePresence === true,
    excludedGameActivityNames: normalizedGameActivityNames(source.excludedGameActivityNames),
    // application_idの除外は名前リストの補助(名前ゆれへの耐性用)。既定値は空で、
    // 実presenceで確認できたidだけをGuild設定へ明示して使う。
    excludedGameApplicationIds: normalizedIds(source.excludedGameApplicationIds, 50),
    countCommandPoints:
      source.countCommandPoints === undefined ? true : source.countCommandPoints === true,
    messagePointsPerMessage: clamp(toInteger(source.messagePointsPerMessage, 2), 0, 20),
    reactionPointsPerReaction: clamp(toInteger(source.reactionPointsPerReaction, 1), 0, 10),
    voicePointsPer10Minutes: clamp(toInteger(source.voicePointsPer10Minutes, 1), 0, 10),
    // オンライン・ゲームは放置/個人的なプレイ時間でも稼げてしまうため、既定値を
    // 低単価(1時間=1pt)+1日上限(2pt = 実質2時間分まで)にして弱く設計する。
    onlinePointsPerHour: clamp(toInteger(source.onlinePointsPerHour, 1), 0, 5),
    onlinePointsDailyCap: clamp(toInteger(source.onlinePointsDailyCap, 2), 0, 50),
    gamePointsPerHour: clamp(toInteger(source.gamePointsPerHour, 1), 0, 5),
    gamePointsDailyCap: clamp(toInteger(source.gamePointsDailyCap, 2), 0, 50),
    achievementPoints: clamp(toInteger(source.achievementPoints, 5), 0, 50),
    commandPointsPerUse: clamp(toInteger(source.commandPointsPerUse, 1), 0, 10),
    commandPointsDailyCap: clamp(toInteger(source.commandPointsDailyCap, 10), 0, 100),
    countLfgPoints: source.countLfgPoints === undefined ? true : source.countLfgPoints === true,
    lfgPointsPerJoin: clamp(toInteger(source.lfgPointsPerJoin, 3), 0, 20),
    lfgPointsDailyCap: clamp(toInteger(source.lfgPointsDailyCap, 15), 0, 100),
    countTeamSplitPoints:
      source.countTeamSplitPoints === undefined ? true : source.countTeamSplitPoints === true,
    teamSplitPointsPerJoin: clamp(toInteger(source.teamSplitPointsPerJoin, 3), 0, 20),
    teamSplitPointsDailyCap: clamp(toInteger(source.teamSplitPointsDailyCap, 15), 0, 100),
    countPollPoints: source.countPollPoints === undefined ? true : source.countPollPoints === true,
    pollPointsPerVote: clamp(toInteger(source.pollPointsPerVote, 1), 0, 10),
    pollPointsDailyCap: clamp(toInteger(source.pollPointsDailyCap, 10), 0, 100),
  };
}

export function evaluateMessageActivity(
  config: ActivityRulesConfig,
  candidate: MessageActivityCandidate,
): MessageActivityEvaluation {
  const notices: MessageActivityNotice[] = [];

  if (config.excludedTextChannelIds.includes(candidate.channelId)) {
    return blocked('excluded_text_channel', notices);
  }
  if (hasExcludedRole(config, candidate.roleIds)) {
    return blocked('excluded_role', notices);
  }

  if (config.excludeCommandMessages) {
    if (!candidate.contentAvailable) {
      notices.push('command_check_skipped_without_content');
    } else {
      const matchedCommandPrefix = findCommandPrefix(
        candidate.content ?? '',
        config.commandPrefixes,
      );
      if (matchedCommandPrefix) {
        return {
          counted: false,
          blockingReason: 'command_prefix',
          matchedCommandPrefix,
          notices,
        };
      }
    }
  }

  if (config.minimumMessageLength > 0) {
    if (!candidate.contentAvailable) {
      notices.push('length_check_skipped_without_content');
    } else if (
      (candidate.contentLength ?? candidate.content?.length ?? 0) < config.minimumMessageLength
    ) {
      return blocked('minimum_message_length', notices);
    }
  }

  return {
    counted: true,
    blockingReason: null,
    matchedCommandPrefix: null,
    notices,
  };
}

export function shouldCountMessage(
  config: ActivityRulesConfig,
  candidate: MessageActivityCandidate,
): boolean {
  return evaluateMessageActivity(config, candidate).counted;
}

export function shouldCountVoice(
  config: ActivityRulesConfig,
  candidate: VoiceActivityCandidate,
): boolean {
  if (!candidate.channelId) return false;
  if (config.excludedVoiceChannelIds.includes(candidate.channelId)) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  if (!config.countSelfMutedVoice && candidate.selfMute) return false;
  if (!config.countServerMutedVoice && candidate.serverMute) return false;
  if (!config.countSelfDeafenedVoice && candidate.selfDeaf) return false;
  if (!config.countServerDeafenedVoice && candidate.serverDeaf) return false;
  return true;
}

export interface PresenceActivityCandidate {
  roleIds?: readonly string[];
}

export function shouldCountOnlinePresence(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countOnlinePresence) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function shouldCountGamePresence(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countGamePresence) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function shouldCountCommandPoints(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countCommandPoints) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function shouldCountLfgPoints(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countLfgPoints) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function shouldCountTeamSplitPoints(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countTeamSplitPoints) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function shouldCountPollPoints(
  config: ActivityRulesConfig,
  candidate: PresenceActivityCandidate,
): boolean {
  if (!config.countPollPoints) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  return true;
}

export function hasMessageCooldownElapsed(
  config: ActivityRulesConfig,
  lastCountedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (config.messageCooldownSeconds <= 0 || lastCountedAt === undefined) return true;
  return now - lastCountedAt >= config.messageCooldownSeconds * 1_000;
}

function blocked(
  blockingReason: MessageActivityBlockingReason,
  notices: MessageActivityNotice[],
): MessageActivityEvaluation {
  return {
    counted: false,
    blockingReason,
    matchedCommandPrefix: null,
    notices,
  };
}

function findCommandPrefix(content: string, prefixes: readonly string[]): string | null {
  const normalized = content.trimStart();
  if (!normalized) return null;
  return prefixes.find((prefix) => normalized.startsWith(prefix)) ?? null;
}

function hasExcludedRole(config: ActivityRulesConfig, roleIds?: readonly string[]): boolean {
  if (!roleIds?.length || config.excludedRoleIds.length === 0) return false;
  return roleIds.some((roleId) => config.excludedRoleIds.includes(roleId));
}

function normalizedIds(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === 'string' && DISCORD_ID_PATTERN.test(item),
      ),
    ),
  ].slice(0, maxItems);
}

/**
 * 除外リストの正規化。未設定(undefined)や配列でない値のときは既定リストを
 * 適用する(後方互換: 既存Guild設定にはこのキーが無いため)。配列が明示された
 * 場合はその内容を正とし、空配列なら除外なしになる。ゲーム名はセッション側の
 * 保存上限(128文字)に合わせ、重複は大文字小文字を区別せず先勝ちで除く。
 */
function normalizedGameActivityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_EXCLUDED_GAME_ACTIVITY_NAMES];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, 128);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 50) break;
  }
  return names;
}

function normalizedCommandPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_COMMAND_PREFIXES];
  const prefixes = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 5 && !/\s/u.test(item)),
    ),
  ].slice(0, 10);
  return prefixes.length > 0 ? prefixes : [...DEFAULT_COMMAND_PREFIXES];
}

function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
