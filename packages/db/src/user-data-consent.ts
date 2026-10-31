import type { PrismaClient } from '@prisma/client';

/**
 * guildを跨がないDiscordアカウント単位の同意設定。VC文字起こしはguild管理者の
 * opt-in(GuildPlugin)だけでは不十分で、録音される本人一人ひとりの同意が必要なため
 * 独立したテーブルとして持つ。
 */
export interface UserDataConsentState {
  userId: string;
  voiceTranscriptionConsent: boolean;
  /** 文字起こし本文の30日保存に本人が同意した日時。nullなら本文は要約後に削除する。 */
  voiceTranscriptRetentionConsentedAt: Date | null;
  updatedAt: Date;
}

const DEFAULT_CONSENT: Omit<UserDataConsentState, 'userId' | 'updatedAt'> = {
  voiceTranscriptionConsent: false,
  voiceTranscriptRetentionConsentedAt: null,
};

export async function getUserDataConsent(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDataConsentState> {
  const row = await prisma.userDataConsent.findUnique({ where: { userId } });
  if (!row) {
    return { userId, updatedAt: new Date(0), ...DEFAULT_CONSENT };
  }
  return toUserDataConsentState(row);
}

export interface SetVoiceTranscriptionConsentOptions {
  /**
   * 本人が文字起こし本文の30日保存を含む説明を見て同意した場合にtrue。
   * 管理者による付与など、本人が保存の説明を見ていない経路では指定しない
   * (既存の保存同意は変更せず、新たに保存同意を付けることもしない)。
   */
  transcriptRetention?: boolean;
}

export async function setVoiceTranscriptionConsent(
  prisma: PrismaClient,
  userId: string,
  consent: boolean,
  options: SetVoiceTranscriptionConsentOptions = {},
): Promise<UserDataConsentState> {
  // 同意を取り消した場合は本文保存の同意も必ず外し、保存済みの本人の本文も削除する。
  // 再同意時は改めて保存の同意を取る。
  const retention = !consent
    ? { voiceTranscriptRetentionConsentedAt: null }
    : options.transcriptRetention
      ? { voiceTranscriptRetentionConsentedAt: new Date() }
      : {};
  const upsert = prisma.userDataConsent.upsert({
    where: { userId },
    create: { userId, voiceTranscriptionConsent: consent, ...retention },
    update: { voiceTranscriptionConsent: consent, ...retention },
  });
  if (consent) return toUserDataConsentState(await upsert);

  // Legacy revocation must also cancel every future recording/archive opt-in.
  // Persist a durable erasure barrier so an archive worker can replay deletion
  // after restoring backups; the barrier is NOT proof of completed S3 deletion.
  const revokedAt = new Date();
  const [row] = await prisma.$transaction([
    upsert,
    prisma.vcRecapTranscriptSegment.deleteMany({ where: { userId } }),
    prisma.vcRecapExplicitConsent.updateMany({
      where: { userId },
      data: { consentedAt: null, revokedAt },
    }),
    prisma.vcRecapErasureRequest.upsert({
      where: { userId },
      create: { userId, requestedAt: revokedAt },
      update: { requestedAt: revokedAt, storageDeletionVerifiedAt: null },
    }),
  ]);
  return toUserDataConsentState(row);
}

/**
 * 管理者による同意の付与。本人の拒否を上書きしないため、レコードが無いときだけ同意済みで
 * 作成する(INSERT ... ON CONFLICT DO NOTHING)。読み取りと書き込みの間に本人が拒否しても
 * 拒否は上書きされない。既に同意済みならその状態を、拒否が記録されていればnullを返す。
 */
export async function grantVoiceTranscriptionConsentUnlessRefused(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDataConsentState | null> {
  await prisma.userDataConsent.createMany({
    data: [{ userId, voiceTranscriptionConsent: true }],
    skipDuplicates: true,
  });
  const row = await prisma.userDataConsent.findUnique({ where: { userId } });
  return row?.voiceTranscriptionConsent ? toUserDataConsentState(row) : null;
}

/**
 * 文字起こし本文の30日保存に同意しているユーザーだけを返す。ロールによる自動同意は
 * 本人が保存の説明を見ていないため含めない(明示的な同意かつ保存同意のあるユーザーのみ)。
 */
export async function getVoiceTranscriptRetentionUserIds(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Set();

  const rows = await prisma.userDataConsent.findMany({
    where: {
      userId: { in: uniqueIds },
      voiceTranscriptionConsent: true,
      voiceTranscriptRetentionConsentedAt: { not: null },
    },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

function toUserDataConsentState(row: {
  userId: string;
  voiceTranscriptionConsent: boolean;
  voiceTranscriptRetentionConsentedAt: Date | null;
  updatedAt: Date;
}): UserDataConsentState {
  return {
    userId: row.userId,
    voiceTranscriptionConsent: row.voiceTranscriptionConsent,
    voiceTranscriptRetentionConsentedAt: row.voiceTranscriptRetentionConsentedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 複数ユーザーの同意状態をまとめて取得する(VC参加者一覧に対する絞り込み用)。
 * 本人(または本人の依頼を受けた管理者)が同意・拒否を選んだユーザーはその値、レコードが
 * 無い(一度も選んでいない)ユーザーはnullを返す。nullは不同意として扱うが、自動同意ロールで
 * 上書きできるのはnullのユーザーだけにするため、明示的なfalseと区別する。
 */
export async function getVoiceTranscriptionConsentMap(
  prisma: PrismaClient,
  userIds: readonly string[],
): Promise<Map<string, boolean | null>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await prisma.userDataConsent.findMany({
    where: { userId: { in: uniqueIds } },
    select: { userId: true, voiceTranscriptionConsent: true },
  });
  const consentById = new Map(rows.map((row) => [row.userId, row.voiceTranscriptionConsent]));
  return new Map(uniqueIds.map((id) => [id, consentById.get(id) ?? null]));
}

/**
 * ロールによる自動同意を重ねた実効的な同意状態を計算する純粋関数(DB書き込みを行わない
 * ランタイムオーバーレイ)。ロール剥奪時に即座に明示的な同意状態へ戻るよう、自動同意は
 * UserDataConsentへ永続化しない。Discordのロールはguildごとに別物のID空間を持つため、
 * この判定自体はguildを跨がない(呼び出し元が渡すroleIdsByUser・autoConsentRoleIdsは
 * いずれもそのguildのものである必要がある)。
 *
 * 本人が拒否・取り消しを選んだ(明示的なfalse)ユーザーは、自動同意ロールを持っていても
 * 対象外にする(本人の拒否を優先する。docs/PRIVACY_POLICY.md)。自動同意ロールが効くのは
 * 一度も選んでいない(null・未登録)ユーザーだけ。
 */
export function applyAutoConsentRoles(
  baseConsent: ReadonlyMap<string, boolean | null>,
  userIds: readonly string[],
  autoConsentRoleIds: readonly string[],
  roleIdsByUser: ReadonlyMap<string, readonly string[]>,
): Map<string, boolean> {
  return new Map(
    userIds.map((id) => {
      const choice = baseConsent.get(id) ?? null;
      if (choice !== null) return [id, choice];
      const hasAutoConsentRole = (roleIdsByUser.get(id) ?? []).some((roleId) =>
        autoConsentRoleIds.includes(roleId),
      );
      return [id, hasAutoConsentRole];
    }),
  );
}
