import { createHmac, randomUUID } from 'node:crypto';

export interface DailyWalletReceipt {
  claimDateJst: string;
  rewardPoints: number;
  streakDay: number;
  rollPoints: number;
  quizBonusPoints: number;
  /** The V1 receipt may provide correct/incorrect, never disclose the answer index here. */
  quizCorrect?: boolean | null;
  channel: string;
  streakReward?: { points: number; streakDay: number };
  firstClaimReward?: { points: number; rank: number; scope: 'global' } | null;
}
type V1ClaimWithQuiz = DailyWalletReceipt & {
  quiz?: { correct?: unknown } | null;
};

/**
 * Why a wallet call could not be confirmed, kept for operator logs only.
 * Never shown to members: the user-facing copy stays the generic
 * retry guidance, but a bare 'unavailable' must not swallow the HTTP
 * status, the API error code or the transport failure again (2026-11-27
 * claim failure was undiagnosable because every layer discarded it).
 */
export type DailyWalletFailure =
  | { kind: 'not_configured' }
  | { kind: 'http'; status: number; errorCode: string | null }
  | { kind: 'invalid_response' }
  | { kind: 'invalid_receipt' }
  | { kind: 'network'; errorName: string };

export type DailyWalletResult =
  | {
      status: 'confirmed';
      receipt: DailyWalletReceipt;
      balance: number;
      message: string;
      alreadyClaimed: boolean;
    }
  | { status: 'ready' }
  | { status: 'profile_required' | 'account_initialization_required' | 'unlinked' }
  | { status: 'unavailable'; failure?: DailyWalletFailure };

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

type RequestOutcome =
  | { type: 'value'; value: Record<string, unknown> }
  | { type: 'setup'; status: 'profile_required' | 'account_initialization_required' }
  | { type: 'unlinked' }
  | { type: 'failure'; failure: DailyWalletFailure };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

async function responseErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

export async function requestDetailed(
  guildId: string,
  userId: string,
  path: string,
  extra: Record<string, unknown> = {},
): Promise<RequestOutcome> {
  let response: Response | null;
  try {
    response = await dailyServiceFetch(guildId, userId, path, extra);
  } catch (error) {
    // A malformed base URL is a configuration problem, not a network one.
    if (error instanceof TypeError && error.message.includes('Invalid URL'))
      return { type: 'failure', failure: { kind: 'not_configured' } };
    return { type: 'failure', failure: { kind: 'network', errorName: errorName(error) } };
  }
  if (!response) return { type: 'failure', failure: { kind: 'not_configured' } };
  if (response.status === 409) {
    const errorCode = await responseErrorCode(response);
    if (errorCode === 'profile_required' || errorCode === 'account_initialization_required')
      return { type: 'setup', status: errorCode };
    if (errorCode === 'identity_or_baseline_unresolved') return { type: 'unlinked' };
    return {
      type: 'failure',
      failure: { kind: 'http', status: response.status, errorCode },
    };
  }
  if (!response.ok)
    return {
      type: 'failure',
      failure: {
        kind: 'http',
        status: response.status,
        errorCode: await responseErrorCode(response),
      },
    };
  let value: Record<string, unknown>;
  try {
    value = (await response.json()) as Record<string, unknown>;
  } catch {
    return { type: 'failure', failure: { kind: 'invalid_response' } };
  }
  if (value.status !== 'ok' || value.guildId !== guildId || value.discordUserId !== userId)
    return { type: 'failure', failure: { kind: 'invalid_response' } };
  return { type: 'value', value };
}

export async function request(
  guildId: string,
  userId: string,
  path: string,
  extra: Record<string, unknown> = {},
) {
  const outcome = await requestDetailed(guildId, userId, path, extra);
  if (outcome.type === 'value') return outcome.value;
  if (outcome.type === 'setup') return { setupRequired: outcome.status };
  if (outcome.type === 'unlinked') return { unlinked: true };
  return null;
}

function invalidReceipt(): DailyWalletResult {
  return { status: 'unavailable', failure: { kind: 'invalid_receipt' } };
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
  const receipt = value?.claim as V1ClaimWithQuiz | undefined,
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
    return invalidReceipt();
  let streakReward: { points: number; streakDay: number } | undefined;
  if (value?.streakReward !== undefined && value.streakReward !== null) {
    const extra = value.streakReward;
    if (
      typeof extra !== 'object' ||
      Array.isArray(extra) ||
      Object.keys(extra).sort().join() !== ['points', 'streakDay'].sort().join()
    )
      return invalidReceipt();
    const item = extra as Record<string, unknown>;
    if (
      !Number.isSafeInteger(item.points) ||
      Number(item.points) < 0 ||
      item.streakDay !== receipt.streakDay ||
      !Number.isSafeInteger(receipt.rewardPoints + Number(item.points))
    )
      return invalidReceipt();
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
      return invalidReceipt();
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
      return invalidReceipt();
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
      quizCorrect: typeof receipt.quiz?.correct === 'boolean' ? receipt.quiz.correct : null,
      channel: receipt.channel,
      ...(streakReward ? { streakReward } : {}),
      ...(firstClaimReward ? { firstClaimReward } : {}),
    },
    balance: account!.balance!,
    alreadyClaimed: value?.mode === 'already_claimed' || value?.claimedToday === true,
    message: `${value?.mode === 'already_claimed' || value?.claimedToday === true ? '本日は受取済みです。' : '🎉 ログインボーナスを受け取りました！'}\n獲得：${receipt.rewardPoints + (streakReward?.points ?? 0) + (firstClaimReward?.points ?? 0)}pt / 保有：${account!.balance}pt / 連続：${receipt.streakDay}日${streakReward ? `\n連続ログイン追加報酬：+${streakReward.points}pt` : ''}`,
  };
}
export async function dailyBonusStatus(guild: string, user: string): Promise<DailyWalletResult> {
  try {
    const outcome = await requestDetailed(guild, user, '/v1/points/herta/login-bonus/status');
    if (outcome.type === 'setup') return { status: outcome.status };
    if (outcome.type === 'unlinked') return { status: 'unlinked' };
    if (outcome.type === 'failure') return { status: 'unavailable', failure: outcome.failure };
    const value = outcome.value;
    if (value.claimedToday)
      return typeof value.todayJst === 'string'
        ? confirmed(value, value.todayJst)
        : { status: 'unavailable', failure: { kind: 'invalid_response' } };
    // The V1 daily quiz was retired (ivrm-web#770): status always reports
    // quiz=null, and a quiz-bearing response is no longer conformant.
    return value.quiz === null
      ? { status: 'ready' }
      : { status: 'unavailable', failure: { kind: 'invalid_response' } };
  } catch (error) {
    return { status: 'unavailable', failure: { kind: 'network', errorName: errorName(error) } };
  }
}
export async function claimDailyBonus(
  guild: string,
  user: string,
  date: string,
  message: string,
): Promise<DailyWalletResult> {
  try {
    const outcome = await requestDetailed(guild, user, '/v1/points/herta/login-bonus/claim', {
      claimDateJst: date,
      announcementMessageId: message,
      idempotencyKey: `daily-login:${guild}:${user}:${date}`,
      // Contract fields deprecated in bundle 1.4.0: claims never carry a
      // V1 quiz answer after the retirement (ivrm-web#770).
      quizId: null,
      choiceIndex: null,
    });
    if (outcome.type === 'setup') return { status: outcome.status };
    if (outcome.type === 'unlinked') return { status: 'unlinked' };
    if (outcome.type === 'failure') return { status: 'unavailable', failure: outcome.failure };
    return confirmed(outcome.value, date);
  } catch (error) {
    return { status: 'unavailable', failure: { kind: 'network', errorName: errorName(error) } };
  }
}
