import type { PrismaClient } from '@herta/db';
import type { FortuneProfile } from './fortune-core.js';

export async function getFortuneProfile(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<FortuneProfile | null> {
  const rows = await prisma.$queryRaw<
    FortuneProfile[]
  >`SELECT birthday, blood_type AS "bloodType", mbti, zodiac, age_group AS "ageGroup", eto FROM fortune_profiles WHERE guild_id = ${guildId} AND user_id = ${userId}`;
  return rows[0] ?? null;
}
export async function saveFortuneProfile(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  p: FortuneProfile,
): Promise<void> {
  await prisma.$executeRaw`INSERT INTO fortune_profiles (guild_id, user_id, birthday, blood_type, mbti, zodiac, age_group, eto) VALUES (${guildId}, ${userId}, ${p.birthday}, ${p.bloodType}, ${p.mbti}, ${p.zodiac}, ${p.ageGroup}, ${p.eto}) ON CONFLICT (guild_id, user_id) DO UPDATE SET birthday = EXCLUDED.birthday, blood_type = EXCLUDED.blood_type, mbti = EXCLUDED.mbti, zodiac = EXCLUDED.zodiac, age_group = EXCLUDED.age_group, eto = EXCLUDED.eto, updated_at = CURRENT_TIMESTAMP`;
}
export async function deleteFortuneProfile(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<void> {
  await prisma.$executeRaw`DELETE FROM fortune_profiles WHERE guild_id = ${guildId} AND user_id = ${userId}`;
}
