/**
 * Daily Quiz (プラグイン ID: daily-quiz / 内部識別子: daily-participation) の
 * ON/OFF 設定の解決 (#887)。
 *
 * 正本は Studio のプラグイン設定ストア (guild_plugins の daily-quiz 行) で、
 * env は kill switch として併存する:
 *
 * - env (`DAILY_PARTICIPATION_ENABLED` / `DAILY_BONUS_RESULT_CARD_ENABLED`) が
 *   'true' でない限り、Studio 設定によらず常時 OFF (fail-closed)。
 * - Studio 未設定 (行が無い / 項目が boolean でない) の間は制限を課さず、
 *   env のみで決まる従来挙動をそのまま維持する。
 * - Studio でプラグイン自体を無効化 (enabled=false) した場合は両項目とも OFF。
 *
 * 実行主体は daily-bonus のままで、この解決結果を参照して ON/OFF を決める。
 */

export interface DailyQuizStudioSettings {
  /** Studio で保存された参加 ON/OFF。未設定なら undefined (= 制限なし)。 */
  participationEnabled?: boolean;
  /** Studio で保存された結果カード ON/OFF。未設定なら undefined (= 制限なし)。 */
  resultCardEnabled?: boolean;
}

interface GuildPluginSettingsRow {
  enabled: boolean;
  config: unknown;
}

interface GuildPluginSettingsClient {
  guildPlugin?: {
    findUnique: (args: {
      where: { guildId_pluginId: { guildId: string; pluginId: string } };
      select: { enabled: true; config: true };
    }) => Promise<GuildPluginSettingsRow | null>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDailyQuizStudioSettings(
  row: GuildPluginSettingsRow | null | undefined,
): DailyQuizStudioSettings {
  if (!row) return {};
  if (!row.enabled) return { participationEnabled: false, resultCardEnabled: false };
  const config = isRecord(row.config) ? row.config : {};
  return {
    participationEnabled:
      typeof config.participationEnabled === 'boolean' ? config.participationEnabled : undefined,
    resultCardEnabled:
      typeof config.resultCardEnabled === 'boolean' ? config.resultCardEnabled : undefined,
  };
}

/**
 * Studio のプラグイン設定ストアから daily-quiz の設定を読む。
 * ストアへ到達できない場合 (Prisma 未配線・読み取り失敗) は未設定として扱い、
 * env のみで決まる従来挙動を維持する (kill switch は env 側に残る)。
 */
export async function loadDailyQuizStudioSettings(
  prisma: unknown,
  guildId: string,
): Promise<DailyQuizStudioSettings> {
  try {
    const client = (prisma as GuildPluginSettingsClient | null | undefined)?.guildPlugin;
    if (!client?.findUnique) return {};
    const row = await client.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'daily-quiz' } },
      select: { enabled: true, config: true },
    });
    return parseDailyQuizStudioSettings(row);
  } catch {
    return {};
  }
}

/** 参加可否の実効値。env の kill switch が最優先で、Studio の明示 OFF も止める。 */
export function dailyQuizParticipationEnabled(
  studio: DailyQuizStudioSettings,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DAILY_PARTICIPATION_ENABLED === 'true' && studio.participationEnabled !== false;
}

/** 結果カード可否の実効値。意味論は参加可否と同じ (env が kill switch)。 */
export function dailyQuizResultCardEnabled(
  studio: DailyQuizStudioSettings,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DAILY_BONUS_RESULT_CARD_ENABLED === 'true' && studio.resultCardEnabled !== false;
}
