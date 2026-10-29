import { dailyFortuneSnapshot, type PrismaClient } from '@herta/db';
import {
  createDailyFortune,
  describeFortuneProfile,
  EMPTY_FORTUNE_PROFILE,
  type FortuneProfile,
} from './fortune-core.js';

export const DAILY_FORTUNE_VERSION = 'fortune-v1';
/** Raw profile hints include literal MBTI/blood type and must not enter history. */
export function savedDailyFortune(
  db: PrismaClient,
  guild: string,
  user: string,
  date: string,
  profile: FortuneProfile,
) {
  if (process.env.DAILY_BONUS_ENABLED !== 'true')
    return Promise.resolve(createDailyFortune(guild, user, date, profile));
  return dailyFortuneSnapshot(db, guild, user, date, DAILY_FORTUNE_VERSION, async () => {
    const result = createDailyFortune(guild, user, date, profile);
    const advice = profile.mbti
      ? `${profile.mbti[0] === 'I' ? '一人で考えを整理してから' : '誰かと短く話してから'}、${profile.mbti[3] === 'J' ? '小さな予定を一つ決めて' : '試せる選択肢を一つ残して'}みましょう。`
      : '';
    return {
      ...result,
      action: advice ? `${result.action}。${advice}` : result.action,
      notes: [] as string[],
      details: describeFortuneProfile(EMPTY_FORTUNE_PROFILE, date),
    };
  });
}
