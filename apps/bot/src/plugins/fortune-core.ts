import { createHash } from 'node:crypto';
import { dailyFortunePattern } from './fortune-patterns.js';

export const SIGNS = [
  '牡羊座',
  '牡牛座',
  '双子座',
  '蟹座',
  '獅子座',
  '乙女座',
  '天秤座',
  '蠍座',
  '射手座',
  '山羊座',
  '水瓶座',
  '魚座',
] as const;
export const ETO = [
  '子',
  '丑',
  '寅',
  '卯',
  '辰',
  '巳',
  '午',
  '未',
  '申',
  '酉',
  '戌',
  '亥',
] as const;
export interface FortuneProfile {
  birthday: string | null;
  bloodType: string | null;
  mbti: string | null;
  zodiac: string | null;
  ageGroup: string | null;
  eto: string | null;
}
export const EMPTY_FORTUNE_PROFILE: FortuneProfile = {
  birthday: null,
  bloodType: null,
  mbti: null,
  zodiac: null,
  ageGroup: null,
  eto: null,
};

export function localFortuneDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Fixed tropical calendar boundaries; not an astronomical natal chart. */
export function zodiacForBirthday(month: number, day: number): string {
  const cutoffs = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
  const index = day < cutoffs[month - 1]! ? month - 2 : month - 1;
  return ['水瓶座', '魚座', ...SIGNS.slice(0, 10)][(index + 12) % 12]!;
}

export function validateFortuneProfile(profile: FortuneProfile, date: string): void {
  if (profile.birthday) {
    const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(profile.birthday);
    if (!match) throw new Error('誕生日は YYYY-MM-DD または MM-DD で入力してください。');
    const year = Number(match[1] ?? 2000),
      month = Number(match[2]),
      day = Number(match[3]);
    const value = new Date(Date.UTC(year, month - 1, day));
    if (
      value.getUTCFullYear() !== year ||
      value.getUTCMonth() + 1 !== month ||
      value.getUTCDate() !== day ||
      (match[1] && (year < 1900 || profile.birthday > date))
    )
      throw new Error('存在する日付・未来ではない誕生日を入力してください（1900年以降）。');
  }
  if (profile.mbti && !/^[EI][SN][TF][JP](?:-[AT])?$/.test(profile.mbti))
    throw new Error('MBTIは INFP または INFP-T の形式で入力してください。');
  if (profile.bloodType && !['A', 'B', 'O', 'AB'].includes(profile.bloodType))
    throw new Error('血液型が正しくありません。');
  if (profile.zodiac && !(SIGNS as readonly string[]).includes(profile.zodiac))
    throw new Error('星座が正しくありません。');
  if (profile.eto && !(ETO as readonly string[]).includes(profile.eto))
    throw new Error('干支が正しくありません。');
  if (
    profile.ageGroup &&
    !['10代以下', '20代', '30代', '40代', '50代', '60代以上'].includes(profile.ageGroup)
  )
    throw new Error('年代が正しくありません。');
  if (
    profile.birthday?.length === 10 &&
    profile.ageGroup &&
    profile.ageGroup !== describeFortuneProfile({ ...profile, ageGroup: null }, date).ageGroup
  )
    throw new Error('生年月日と年代が一致しません。年代は自動計算できます。');
}

export function describeFortuneProfile(profile: FortuneProfile, date: string) {
  const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(profile.birthday ?? '');
  const year = match?.[1] ? Number(match[1]) : null;
  const age =
    year === null
      ? null
      : Number(date.slice(0, 4)) - year - (date.slice(5) < profile.birthday!.slice(5) ? 1 : 0);
  return {
    zodiac:
      profile.zodiac ?? (match ? zodiacForBirthday(Number(match[2]), Number(match[3])) : null),
    eto: profile.eto ?? (year === null ? null : ETO[(year - 4) % 12]!),
    age,
    ageGroup:
      age === null
        ? profile.ageGroup
        : age < 20
          ? '10代以下'
          : age >= 60
            ? '60代以上'
            : `${Math.floor(age / 10) * 10}代`,
  };
}

const SIGN_NOTES = [
  '始めたいことを一つ選ぶ',
  '心地よい環境を整える',
  '気になることを質問する',
  '落ち着ける時間をつくる',
  '得意なことを一つ表現する',
  '細かな工夫を楽しむ',
  '自分と相手の希望を一つずつ聞く',
  '集中できる小さな目標を置く',
  '知らない分野を少し調べる',
  '次の一歩だけ予定に書く',
  'いつもと違う見方を試す',
  '感じたことを短くメモする',
];

/** Stable daily draw excludes mutable profile fields, preventing profile edits from rerolling luck. */
export function createDailyFortune(
  guildId: string,
  userId: string,
  date: string,
  profile: FortuneProfile,
) {
  validateFortuneProfile(profile, date);
  const seed = createHash('sha256')
    .update(JSON.stringify(['herta-fortune-v1', guildId, userId, date]))
    .digest();
  const theme = dailyFortunePattern(guildId, userId, date);
  const details = describeFortuneProfile(profile, date);
  const notes: string[] = [];
  if (details.zodiac)
    notes.push(
      `${details.zodiac}のヒント：${SIGN_NOTES[SIGNS.indexOf(details.zodiac as (typeof SIGNS)[number])]!}。`,
    );
  if (profile.mbti)
    notes.push(
      `${profile.mbti}の振り返り：${profile.mbti[0] === 'I' ? '一人で考えを整理してから' : '誰かと短く話してから'}、${profile.mbti[3] === 'J' ? '小さな予定を一つ決めて' : '試せる選択肢を一つ残して'}みましょう。`,
    );
  if (details.ageGroup)
    notes.push(
      `${details.ageGroup}のあなたへ：周りのペースと比べず、今の暮らしで続けやすい一歩を選んで。`,
    );
  if (profile.bloodType)
    notes.push(
      `${profile.bloodType}型の遊びの合言葉：${['「ゆっくりでOK」', '「まず一つ」', '「発見を楽しもう」', '「自分のペースで」'][seed[7]! % 4]}。血液型から性格を決めつけません。`,
    );
  if (details.eto)
    notes.push(
      `${details.eto}年のモチーフをお守りに、${seed[8]! % 2 ? '好きなものを写真に一枚残して' : '今日できたことを一つ書いて'}みて。`,
    );
  if (profile.birthday?.slice(-5) === date.slice(-5))
    notes.unshift('今日はお誕生日！自分のための小さなお祝いを一つ。');
  const categories = ['対人運', '恋愛運', '仕事・学び運', '金運', 'リフレッシュ運'].map(
    (name, index) => ({
      name,
      stars: 1 + (seed[index + 2]! % 5),
      advice: [
        [
          '返事を急がず、自分の余裕も大切に。',
          '挨拶に短いひと言を添えてみて。',
          '感謝を伝えるきっかけを一つ。',
        ],
        [
          '相手の反応を決めつけず、距離感を大切に。',
          '好きなものの話から自然な会話を。',
          '思いやりを小さな言葉で届けて。',
        ],
        [
          'やることを一つに絞って丁寧に。',
          '一区切りごとに進み方を見直して。',
          '温めていた案を小さく試す日に。',
        ],
        [
          '勢いで買わず、必要なものか確認を。',
          '使う前に予算と持ち物をチェック。',
          '新しく買う前に、持ち物の良さを再発見。',
        ],
        [
          '予定に余白を入れて、自分のペースを守って。',
          'お気に入りの音や景色で気分転換。',
          '楽しかったことを一つ書き留めて。',
        ],
      ][index]![Math.floor((seed[index + 2]! % 5) / 2)]!,
    }),
  );
  return {
    date,
    ...theme,
    stars: 1 + (seed[1]! % 5),
    categories,
    notes,
    details,
    luckyNumber: 1 + (seed[9]! % 9),
    luckyTime: ['朝', '昼', '夕方', '夜'][seed[10]! % 4]!,
    disclaimer:
      'エンタメ占いです。星は演出で、未来の予測確率ではありません。大切な判断は現実の情報をもとに。',
  };
}

export type DailyFortune = ReturnType<typeof createDailyFortune>;
