import { createHmac, randomUUID } from 'node:crypto';

export interface DailyQuiz {
  quizId: string;
  question: string;
  choices: string[];
  kind: 'quiz' | 'riddle';
}
export interface DailyWalletReceipt {
  claimDateJst: string;
  rewardPoints: number;
  streakDay: number;
  rollPoints: number;
  quizBonusPoints: number;
  channel: string;
  streakReward?: { points: number; streakDay: number };
  firstClaimReward?: { points: number; rank: number; scope: 'global' } | null;
}
export type DailyWalletResult =
  | {
      status: 'confirmed';
      receipt: DailyWalletReceipt;
      balance: number;
      message: string;
      alreadyClaimed: boolean;
    }
  | { status: 'quiz'; quiz: DailyQuiz }
  | { status: 'ready' }
  | { status: 'profile_required' | 'account_initialization_required' | 'unlinked' | 'unavailable' };

export async function dailyServiceFetch(
  guildId: string,
  userId: string,
  path: string,
  extra: Record<string, unknown> = {},
) {
  const base = process.env.IVRM_WEB_API_BASE_URL,
    secret = process.env.HERTA_POINTS_SECRET;
  if (!base || !secret || process.env.IVRM_INTEGRATION_GUILD_ID !== guildId) return null;
  const url = new URL(base);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    return null;
  const body = JSON.stringify({ guildId, discordUserId: userId, ...extra }),
    timestamp = new Date().toISOString(),
    event = randomUUID();
  return fetch(new URL(path, url), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      'Content-Type': 'application/json',
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', secret)
        .update(`${timestamp}.${event}.POST.${path}.${body}`)
        .digest('hex'),
    },
    body,
  });
}
export async function request(
  guildId: string,
  userId: string,
  path: string,
  extra: Record<string, unknown> = {},
) {
  const response = await dailyServiceFetch(guildId, userId, path, extra);
  if (!response) return null;
  if (response.status === 409) {
    const error = (await response.json()) as { error?: string };
    if (error.error === 'profile_required' || error.error === 'account_initialization_required')
      return { setupRequired: error.error };
    return error.error === 'identity_or_baseline_unresolved' ? { unlinked: true } : null;
  }
  if (!response.ok) return null;
  const value = (await response.json()) as Record<string, unknown>;
  if (value.status !== 'ok' || value.guildId !== guildId || value.discordUserId !== userId)
    return null;
  return value;
}

function confirmed(
  value: Record<string, unknown> | null,
  expectedDate?: string,
): DailyWalletResult {
  if (
    value?.setupRequired === 'profile_required' ||
    value?.setupRequired === 'account_initialization_required'
  )
    return { status: value.setupRequired };
  if (value?.unlinked) return { status: 'unlinked' };
  const receipt = value?.claim as DailyWalletReceipt | undefined,
    account = value?.account as { balance?: number } | undefined;
  if (
    !receipt ||
    !Number.isSafeInteger(receipt.rewardPoints) ||
    receipt.rewardPoints < 0 ||
    !/^\d{4}-\d\d-\d\d$/.test(receipt.claimDateJst) ||
    (expectedDate !== undefined && receipt.claimDateJst !== expectedDate) ||
    !Number.isSafeInteger(receipt.rollPoints) ||
    receipt.rollPoints < 0 ||
    !Number.isSafeInteger(receipt.quizBonusPoints) ||
    receipt.quizBonusPoints < 0 ||
    receipt.rollPoints + receipt.quizBonusPoints !== receipt.rewardPoints ||
    !['web', 'discord'].includes(receipt.channel) ||
    !Number.isSafeInteger(receipt.streakDay) ||
    receipt.streakDay < 1 ||
    !Number.isSafeInteger(account?.balance) ||
    account!.balance! < 0
  )
    return { status: 'unavailable' };
  let streakReward: { points: number; streakDay: number } | undefined;
  if (value?.streakReward !== undefined && value.streakReward !== null) {
    const extra = value.streakReward;
    if (
      typeof extra !== 'object' ||
      Array.isArray(extra) ||
      Object.keys(extra).sort().join() !== ['points', 'streakDay'].sort().join()
    )
      return { status: 'unavailable' };
    const item = extra as Record<string, unknown>;
    if (
      !Number.isSafeInteger(item.points) ||
      Number(item.points) < 0 ||
      item.streakDay !== receipt.streakDay ||
      !Number.isSafeInteger(receipt.rewardPoints + Number(item.points))
    )
      return { status: 'unavailable' };
    streakReward = { points: Number(item.points), streakDay: receipt.streakDay };
  }
  let firstClaimReward: DailyWalletReceipt['firstClaimReward'];
  if (value?.firstClaimReward !== undefined && value.firstClaimReward !== null) {
    const raw = value.firstClaimReward;
    if (
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join() !== 'points,rank,scope'
    )
      return { status: 'unavailable' };
    const extra = raw as Record<string, unknown>;
    if (
      !Number.isSafeInteger(extra.points) ||
      Number(extra.points) < 0 ||
      Number(extra.points) > 100000 ||
      !Number.isSafeInteger(extra.rank) ||
      Number(extra.rank) < 1 ||
      extra.scope !== 'global' ||
      !Number.isSafeInteger(
        receipt.rewardPoints + (streakReward?.points ?? 0) + Number(extra.points),
      )
    )
      return { status: 'unavailable' };
    firstClaimReward = { points: Number(extra.points), rank: Number(extra.rank), scope: 'global' };
  }
  return {
    status: 'confirmed',
    receipt: {
      claimDateJst: receipt.claimDateJst,
      rewardPoints: receipt.rewardPoints,
      streakDay: receipt.streakDay,
      rollPoints: receipt.rollPoints,
      quizBonusPoints: receipt.quizBonusPoints,
      channel: receipt.channel,
      ...(streakReward ? { streakReward } : {}),
      ...(firstClaimReward ? { firstClaimReward } : {}),
    },
    balance: account!.balance!,
    alreadyClaimed: value?.mode === 'already_claimed' || value?.claimedToday === true,
    message: `${value?.mode === 'already_claimed' || value?.claimedToday === true ? '本日は受取済みです。' : '🎉 ログインボーナスを受け取りました！'}\n獲得：${receipt.rewardPoints + (streakReward?.points ?? 0) + (firstClaimReward?.points ?? 0)}pt / 保有：${account!.balance}pt / 連続：${receipt.streakDay}日${streakReward ? `\n連続ログイン追加報酬：+${streakReward.points}pt` : ''}${firstClaimReward ? `\n一番乗り追加報酬：+${firstClaimReward.points}pt / ${firstClaimReward.rank}位` : ''}`,
  };
}
export async function dailyBonusStatus(guild: string, user: string): Promise<DailyWalletResult> {
  try {
    const value = await request(guild, user, '/v1/points/herta/login-bonus/status');
    if (
      value?.setupRequired === 'profile_required' ||
      value?.setupRequired === 'account_initialization_required'
    )
      return { status: value.setupRequired };
    if (value?.unlinked) return { status: 'unlinked' };
    if (value?.claimedToday)
      return typeof value.todayJst === 'string'
        ? confirmed(value, value.todayJst)
        : { status: 'unavailable' };
    const quiz = value?.quiz as DailyQuiz | undefined;
    if (
      quiz &&
      /^[A-Za-z0-9_-]{1,64}$/.test(quiz.quizId) &&
      typeof quiz.question === 'string' &&
      quiz.question.length <= 300 &&
      Array.isArray(quiz.choices) &&
      quiz.choices.length === 4 &&
      quiz.choices.every((choice) => typeof choice === 'string' && choice.length <= 80)
    )
      return { status: 'quiz', quiz };
    return value?.quiz === null ? { status: 'ready' } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
export async function claimDailyBonus(
  guild: string,
  user: string,
  date: string,
  message: string,
  quizId: string | null = null,
  choiceIndex: number | null = null,
): Promise<DailyWalletResult> {
  try {
    return confirmed(
      await request(guild, user, '/v1/points/herta/login-bonus/claim', {
        claimDateJst: date,
        announcementMessageId: message,
        idempotencyKey: `daily-login:${guild}:${user}:${date}`,
        quizId,
        choiceIndex,
      }),
      date,
    );
  } catch {
    return { status: 'unavailable' };
  }
}
