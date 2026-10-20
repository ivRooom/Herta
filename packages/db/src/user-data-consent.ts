import type { PrismaClient } from '@prisma/client';

/**
 * guildを跨がないDiscordアカウント単位の同意設定。VC文字起こしはguild管理者の
 * opt-in(GuildPlugin)だけでは不十分で、録音される本人一人ひとりの同意が必要なため
 * 独立したテーブルとして持つ。
 */
export interface UserDataConsentState {
  userId: string;
  voiceTranscriptionConsent: boolean;
  updatedAt: Date;
}

const DEFAULT_CONSENT: Omit<UserDataConsentState, 'userId' | 'updatedAt'> = {
  voiceTranscriptionConsent: false,
};

export async function getUserDataConsent(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDataConsentState> {
  const row = await prisma.userDataConsent.findUnique({ where: { userId } });
  if (!row) {
    return { userId, updatedAt: new Date(0), ...DEFAULT_CONSENT };
  }
  return {
    userId: row.userId,
    voiceTranscriptionConsent: row.voiceTranscriptionConsent,
    updatedAt: row.updatedAt,
  };
}

export async function setVoiceTranscriptionConsent(
  prisma: PrismaClient,
  userId: string,
  consent: boolean,
): Promise<UserDataConsentState> {
  const row = await prisma.userDataConsent.upsert({
    where: { userId },
    create: { userId, voiceTranscriptionConsent: consent },
    update: { voiceTranscriptionConsent: consent },
  });
  return {
    userId: row.userId,
    voiceTranscriptionConsent: row.voiceTranscriptionConsent,
    updatedAt: row.updatedAt,
  };
}

/**
 * 複数ユーザーの同意状態をまとめて取得する(VC参加者一覧に対する絞り込み用)。
 * レコードが無いユーザーはvoiceTranscriptionConsent: falseとして扱う(既定は不同意)。
 */
export async function getVoiceTranscriptionConsentMap(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Map<string, boolean>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await prisma.userDataConsent.findMany({
    where: { userId: { in: uniqueIds } },
    select: { userId: true, voiceTranscriptionConsent: true },
  });
  const consentById = new Map(rows.map((row) => [row.userId, row.voiceTranscriptionConsent]));
  return new Map(uniqueIds.map((id) => [id, consentById.get(id) ?? false]));
}

/**
 * ロールによる自動同意を重ねた実効的な同意状態を計算する純粋関数(DB書き込みを行わない
 * ランタイムオーバーレイ)。ロール剥奪時に即座に明示的な同意状態へ戻るよう、自動同意は
 * UserDataConsentへ永続化しない。Discordのロールはguildごとに別物のID空間を持つため、
 * この判定自体はguildを跨がない(呼び出し元が渡すroleIdsByUser・autoConsentRoleIdsは
 * いずれもそのguildのものである必要がある)。
 */
export function applyAutoConsentRoles(
  baseConsent: ReadonlyMap<string, boolean>,
  userIds: readonly string[],
  autoConsentRoleIds: readonly string[],
  roleIdsByUser: ReadonlyMap<string, readonly string[]>,
): Map<string, boolean> {
  if (autoConsentRoleIds.length === 0) return new Map(baseConsent);
  return new Map(
    userIds.map((id) => {
      const hasAutoConsentRole = (roleIdsByUser.get(id) ?? []).some((roleId) =>
        autoConsentRoleIds.includes(roleId),
      );
      return [id, hasAutoConsentRole || (baseConsent.get(id) ?? false)];
    }),
  );
}
