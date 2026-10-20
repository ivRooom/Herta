import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * VC発言の文字起こし同意を専用URL(マジックリンク)経由で行うためのトークン発行・解決。
 * mbti-personal-results.tsのissueMbtiResultAccess/resolveMbtiResultAccessと同じ
 * セキュリティパターン(sha256ハッシュのみ保存、再発行で前回linkを無効化)。
 */
export const VOICE_CONSENT_ACCESS_MS = 30 * 60 * 1000;

export async function issueVoiceConsentAccess(
  prisma: PrismaClient,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + VOICE_CONSENT_ACCESS_MS);
  const data = { tokenHash: hashToken(token), expiresAt };
  await prisma.voiceConsentAccess.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return { token, expiresAt };
}

export async function resolveVoiceConsentAccess(
  prisma: PrismaClient,
  token: string,
): Promise<{ userId: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const access = await prisma.voiceConsentAccess.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  return access && access.expiresAt.getTime() > Date.now() ? { userId: access.userId } : null;
}

export async function pruneVoiceConsentAccess(prisma: PrismaClient) {
  return prisma.voiceConsentAccess.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
