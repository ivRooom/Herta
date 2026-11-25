import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildSubmissionReviewApiRequest,
  buildSubmissionReviewApproveModal,
  buildSubmissionReviewButtons,
  buildSubmissionReviewEmbed,
  buildSubmissionReviewNoticeEmbed,
  buildSubmissionReviewProcessedEmbed,
  buildSubmissionReviewReturnModal,
  canReviewSubmissions,
  collectSubmissionNotificationTimes,
  formatRewardPoints,
  formatSubmissionReviewApiError,
  handleSubmissionReviewComponent,
  normalizeSubmissionReviewConfig,
  parseReviewPointsInput,
  parseSubmissionReviewComponentId,
  parseSubmissionReviewPending,
  rememberSubmissionReviewOperator,
  resolveSubmissionReviewApiConfig,
  runSubmissionReviewCycle,
  selectSubmissionNotifications,
  submissionReviewKey,
  type SubmissionReviewPendingItem,
} from './submission-review.js';

const approverRoleId = '222222222222222222';
const guildId = '964326043420872704';
const opsChannelId = '1573128498623676446';
const botUserId = '999999999999999999';
const operatorId = '111111111111111111';

const dailyItem: SubmissionReviewPendingItem = {
  kind: 'daily_quiz',
  id: 'dqs_1',
  state: 'submitted',
  title: '日本の首都はどこ？',
  authorDisplayName: 'member-a',
  authorDiscordUserId: '333333333333333333',
  submittedAt: '2026-11-25T00:00:00.000Z',
  reviewLink: 'https://admin.ivrm.jp/daily-quiz-reviews',
  canReview: true,
  daily: {
    question: '日本の首都はどこ？',
    choices: ['大阪', '東京', '名古屋', '福岡'],
    correctChoiceIndex: 1,
    explanation: '東京です',
    category: 'quiz',
    quizId: 'community_abc',
  },
  today: null,
};

const todayItem: SubmissionReviewPendingItem = {
  kind: 'today_history',
  id: 'the_1',
  state: 'pending_review',
  title: 'テスト記念日',
  authorDisplayName: 'member-b',
  authorDiscordUserId: '444444444444444444',
  submittedAt: '2026-11-25T01:00:00.000Z',
  reviewLink: 'https://admin.ivrm.jp/today-history',
  canReview: true,
  daily: null,
  today: {
    summary: 'テストの記念日です',
    category: 'game',
    recurrence: 'annual',
    monthDay: '11-25',
    exactDate: null,
    originYear: 2020,
    sourceUrl: 'https://example.com/source',
    sourceLabel: '公式',
  },
};

describe('parseSubmissionReviewComponentId', () => {
  it('dqr / thr の全アクションを解析する', () => {
    expect(parseSubmissionReviewComponentId('dqr:approve:dqs_1')).toEqual({
      kind: 'daily_quiz',
      action: 'approve',
      id: 'dqs_1',
    });
    expect(parseSubmissionReviewComponentId('thr:approve-custom:the_1')).toEqual({
      kind: 'today_history',
      action: 'approve-custom',
      id: 'the_1',
    });
    expect(parseSubmissionReviewComponentId('dqr:return:dqs_1')?.action).toBe('return');
    expect(parseSubmissionReviewComponentId('thr:status:the_1')?.action).toBe('status');
    expect(parseSubmissionReviewComponentId('dqr:approve-submit:dqs_1')?.action).toBe(
      'approve-submit',
    );
    expect(parseSubmissionReviewComponentId('thr:return-submit:the_1')?.action).toBe(
      'return-submit',
    );
  });

  it('未知の prefix / アクション / ID 欠落は null', () => {
    expect(parseSubmissionReviewComponentId('mcw:approve:x')).toBeNull();
    expect(parseSubmissionReviewComponentId('dqr:unknown:dqs_1')).toBeNull();
    expect(parseSubmissionReviewComponentId('dqr:approve:')).toBeNull();
    expect(parseSubmissionReviewComponentId('dqr:approve')).toBeNull();
    expect(parseSubmissionReviewComponentId('dqr::dqs_1')).toBeNull();
  });
});

describe('normalizeSubmissionReviewConfig / canReviewSubmissions', () => {
  it('チャンネルIDの形式を検証し、ロールを正規化する', () => {
    const config = normalizeSubmissionReviewConfig({
      enabled: true,
      opsChannelId,
      approverRoleIds: [approverRoleId, approverRoleId, 'bad'],
    });
    expect(config.opsChannelId).toBe(opsChannelId);
    expect(config.approverRoleIds).toEqual([approverRoleId]);
    expect(normalizeSubmissionReviewConfig({ opsChannelId: 'abc' }).opsChannelId).toBe('');
    expect(normalizeSubmissionReviewConfig(null).enabled).toBe(true);
  });

  it('ロール未設定なら全員不可 (fail-closed)', () => {
    const config = normalizeSubmissionReviewConfig({ approverRoleIds: [] });
    expect(canReviewSubmissions({ member: { roles: [approverRoleId] } }, config)).toBe(false);
  });

  it('承認ロールの保持者だけ許可する', () => {
    const config = normalizeSubmissionReviewConfig({ approverRoleIds: [approverRoleId] });
    expect(canReviewSubmissions({ member: { roles: [approverRoleId] } }, config)).toBe(true);
    expect(canReviewSubmissions({ member: { roles: ['555555555555555555'] } }, config)).toBe(false);
    expect(canReviewSubmissions({ member: undefined }, config)).toBe(false);
  });
});

describe('Review Bot API クライアント', () => {
  it('env が揃わない場合は null', () => {
    expect(resolveSubmissionReviewApiConfig({})).toBeNull();
    expect(
      resolveSubmissionReviewApiConfig({ IVRM_WEB_API_BASE_URL: 'https://api.example.test' }),
    ).toBeNull();
    expect(
      resolveSubmissionReviewApiConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.example.test/',
        HERTA_REVIEW_BOT_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.example.test', secret: 'secret' });
  });

  it('署名が S1 (herta-review-service-auth) の形式と一致する', () => {
    const request = buildSubmissionReviewApiRequest(
      { apiBaseUrl: 'https://api.example.test', secret: 'test-secret' },
      '/review/bot/pending',
      { discordUserId: operatorId, guildId, approverRoleVerified: true },
      { timestamp: '1764046800000', eventId: 'sr-test-event' },
    );
    const body = JSON.stringify({
      discordUserId: operatorId,
      guildId,
      approverRoleVerified: true,
    });
    const expected = createHmac('sha256', 'test-secret')
      .update(`1764046800000.sr-test-event.POST./review/bot/pending.${body}`)
      .digest('hex');
    expect(request.url).toBe('https://api.example.test/review/bot/pending');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe('sr-test-event');
    expect(request.init.body).toBe(body);
  });
});

describe('parseReviewPointsInput', () => {
  it('有効な金額を受け付ける', () => {
    expect(parseReviewPointsInput('5.0')).toEqual({ ok: true, points: 5 });
    expect(parseReviewPointsInput(' 7.5 ')).toEqual({ ok: true, points: 7.5 });
    expect(parseReviewPointsInput('30')).toEqual({ ok: true, points: 30 });
    expect(parseReviewPointsInput('1.0')).toEqual({ ok: true, points: 1 });
  });

  it('範囲外・刻み違反・非数値を弾く', () => {
    expect(parseReviewPointsInput('0.5').ok).toBe(false);
    expect(parseReviewPointsInput('30.5').ok).toBe(false);
    expect(parseReviewPointsInput('7.3').ok).toBe(false);
    expect(parseReviewPointsInput('abc').ok).toBe(false);
    expect(parseReviewPointsInput('').ok).toBe(false);
  });

  it('formatRewardPoints は milli を pt 表示にする', () => {
    expect(formatRewardPoints(5000)).toBe('5.0');
    expect(formatRewardPoints(7500)).toBe('7.5');
  });
});

describe('parseSubmissionReviewPending', () => {
  it('S1 の pending 応答を統一形へ変換する', () => {
    const items = parseSubmissionReviewPending({
      items: [
        {
          kind: 'daily_quiz',
          id: 'dqs_1',
          state: 'submitted',
          authorDisplayName: 'member-a',
          authorDiscordUserId: '333333333333333333',
          submittedAt: '2026-11-25T00:00:00.000Z',
          reviewLink: 'https://admin.ivrm.jp/daily-quiz-reviews',
          quizId: 'community_abc',
          quiz: {
            question: '日本の首都はどこ？',
            choices: ['大阪', '東京', '名古屋', '福岡'],
            correctChoiceIndex: 1,
            explanation: '東京です',
            category: 'quiz',
          },
        },
        {
          kind: 'today_history',
          id: 'the_1',
          state: 'pending_review',
          title: 'テスト記念日',
          summary: 'テストの記念日です',
          category: 'game',
          recurrence: 'annual',
          monthDay: '11-25',
          originYear: 2020,
          sourceUrl: 'https://example.com/source',
          authorDisplayName: 'member-b',
          authorDiscordUserId: '444444444444444444',
          submittedAt: '2026-11-25T01:00:00.000Z',
          createdAt: '2026-11-25T01:00:00.000Z',
          reviewLink: 'https://admin.ivrm.jp/today-history',
          canReview: false,
        },
        { kind: 'unknown', id: 'x' },
        { kind: 'daily_quiz' },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('日本の首都はどこ？');
    expect(items[0]?.daily?.correctChoiceIndex).toBe(1);
    expect(items[1]?.today?.sourceUrl).toBe('https://example.com/source');
    expect(items[1]?.canReview).toBe(false);
  });
});

describe('Embed / ボタン / モーダル', () => {
  const nowMs = Date.parse('2026-11-25T02:00:00.000Z');

  it('デイリー通知に選択肢・正解・申請ID・審査リンクが入る', () => {
    const embed = buildSubmissionReviewEmbed(dailyItem, nowMs);
    const text = JSON.stringify(embed);
    expect(text).toContain('東京 ✅');
    expect(text).toContain('申請ID: dqs_1');
    expect(text).toContain('種別キー: dqr:dqs_1');
    expect(text).toContain('https://admin.ivrm.jp/daily-quiz-reviews');
    expect(embed.title).toContain('デイリー問題の申請が届きました');
  });

  it('今日は何の日の通知に対象日・出典・出典確認の注記が入る', () => {
    const embed = buildSubmissionReviewEmbed(todayItem, nowMs);
    const text = JSON.stringify(embed);
    expect(text).toContain('https://example.com/source');
    expect(text).toContain('11-25');
    expect(text).toContain('出典を確認済みとして記録');
  });

  it('リマインドはタイトルが変わる', () => {
    const embed = buildSubmissionReviewEmbed(dailyItem, nowMs, 'reminder');
    expect(embed.title).toContain('リマインド');
  });

  it('ボタン行に4ボタン + Webリンクが入る', () => {
    const rows = buildSubmissionReviewButtons(dailyItem);
    const text = JSON.stringify(rows);
    expect(text).toContain('dqr:approve:dqs_1');
    expect(text).toContain('dqr:approve-custom:dqs_1');
    expect(text).toContain('dqr:return:dqs_1');
    expect(text).toContain('dqr:status:dqs_1');
    expect(text).toContain('https://admin.ivrm.jp/daily-quiz-reviews');
    const todayRows = buildSubmissionReviewButtons(todayItem);
    expect(JSON.stringify(todayRows)).toContain('thr:approve:the_1');
  });

  it('モーダルの customId と入力上限が種別に合う', () => {
    const approve = buildSubmissionReviewApproveModal('today_history', 'the_1');
    expect(approve.custom_id).toBe('thr:approve-submit:the_1');
    expect(approve.title).toContain('出典確認済みとして記録');
    const dailyReturn = buildSubmissionReviewReturnModal('daily_quiz', 'dqs_1');
    const todayReturn = buildSubmissionReviewReturnModal('today_history', 'the_1');
    const dailyInput = (dailyReturn.components?.[0] as { components: { max_length?: number }[] })
      .components[0];
    const todayInput = (todayReturn.components?.[0] as { components: { max_length?: number }[] })
      .components[0];
    expect(dailyInput?.max_length).toBe(1000);
    expect(todayInput?.max_length).toBe(500);
  });

  it('処理済み Embed と DM Embed に結果が入る', () => {
    const processed = buildSubmissionReviewProcessedEmbed({
      kind: 'daily_quiz',
      id: 'dqs_1',
      title: dailyItem.title,
      action: 'approve',
      approverDiscordUserId: operatorId,
      rewardPoints: 7.5,
      questionCreated: true,
      questionStatus: 'approved',
    });
    const text = JSON.stringify(processed);
    expect(text).toContain('7.5 pt');
    expect(text).toContain('作成済み');
    const notice = buildSubmissionReviewNoticeEmbed({
      kind: 'today_history',
      id: 'the_1',
      title: todayItem.title,
      action: 'return',
      approverDiscordUserId: operatorId,
      reason: '出典が不足しています',
    });
    expect(JSON.stringify(notice)).toContain('出典が不足しています');
  });
});

describe('通知の dedup / 振り分け', () => {
  const nowMs = Date.parse('2026-11-25T02:00:00.000Z');

  it('履歴から種別キーごとの最終通知時刻を復元する (Bot 自身の投稿のみ)', () => {
    const times = collectSubmissionNotificationTimes(
      [
        {
          author: { id: botUserId },
          createdTimestamp: nowMs - 60 * 60 * 1000,
          embeds: [{ fields: [{ name: '申請情報', value: '申請ID: dqs_1\n種別キー: dqr:dqs_1' }] }],
        },
        {
          author: { id: 'someone-else' },
          createdTimestamp: nowMs,
          embeds: [{ fields: [{ name: '申請情報', value: '申請ID: dqs_1\n種別キー: dqr:dqs_1' }] }],
        },
        {
          author: { id: botUserId },
          createdTimestamp: nowMs - 30 * 60 * 1000,
          embeds: [{ fields: [{ name: '申請情報', value: '申請ID: the_1\n種別キー: thr:the_1' }] }],
        },
      ],
      botUserId,
    );
    expect(times.get('dqr:dqs_1')).toBe(nowMs - 60 * 60 * 1000);
    expect(times.get('thr:the_1')).toBe(nowMs - 30 * 60 * 1000);
  });

  it('未通知は即時、24時間未満は送らず、24時間以上でリマインド', () => {
    const notified = new Map<string, number>([
      [submissionReviewKey(dailyItem), nowMs - 23 * 60 * 60 * 1000],
      [submissionReviewKey(todayItem), nowMs - 24 * 60 * 60 * 1000],
    ]);
    const { fresh, reminders } = selectSubmissionNotifications(
      [dailyItem, todayItem, { ...dailyItem, id: 'dqs_new' }],
      notified,
      nowMs,
    );
    expect(fresh.map((item) => item.id)).toEqual(['dqs_new']);
    expect(reminders.map((item) => item.id)).toEqual(['the_1']);
  });
});

describe('formatSubmissionReviewApiError', () => {
  it('主要コードを日本語化する', () => {
    const wrap = (code: string, status = 400) => ({
      ok: false,
      status,
      data: { code },
    });
    expect(formatSubmissionReviewApiError(wrap('today_history_self_review', 403))).toContain(
      '自分の申請は審査できません',
    );
    expect(formatSubmissionReviewApiError(wrap('approver_role_required', 403))).toContain(
      '専用ロールが必要',
    );
    expect(formatSubmissionReviewApiError(wrap('reward_half_point_not_grantable', 422))).toContain(
      '整数のポイント',
    );
    expect(formatSubmissionReviewApiError(wrap('invalid_transition', 409))).toContain(
      '既に処理された可能性',
    );
    expect(formatSubmissionReviewApiError(wrap('bot_api_disabled', 401))).toContain('有効化されて');
    expect(formatSubmissionReviewApiError({ ok: false, status: 0, data: null })).toContain(
      '接続できませんでした',
    );
  });
});

describe('handleSubmissionReviewComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['IVRM_WEB_API_BASE_URL'];
    delete process.env['HERTA_REVIEW_BOT_SECRET'];
  });

  const pendingPayload = {
    items: [
      {
        kind: 'daily_quiz',
        id: 'dqs_1',
        state: 'submitted',
        authorDisplayName: 'member-a',
        authorDiscordUserId: '333333333333333333',
        submittedAt: '2026-11-25T00:00:00.000Z',
        reviewLink: 'https://admin.ivrm.jp/daily-quiz-reviews',
        quizId: 'community_abc',
        quiz: {
          question: '日本の首都はどこ？',
          choices: ['大阪', '東京', '名古屋', '福岡'],
          correctChoiceIndex: 1,
          category: 'quiz',
        },
      },
    ],
  };

  function setupFetch(options: { approveStatus?: number; approveData?: unknown } = {}) {
    process.env['IVRM_WEB_API_BASE_URL'] = 'https://api.example.test';
    process.env['HERTA_REVIEW_BOT_SECRET'] = 'test-secret';
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let pendingCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });
      if (url.endsWith('/review/bot/pending')) {
        pendingCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => (pendingCount === 1 ? pendingPayload : { items: [] }),
        };
      }
      const status = options.approveStatus ?? 200;
      return {
        ok: status < 300,
        status,
        json: async () =>
          options.approveData ?? {
            status: 'ok',
            rewardMilli: 5000,
            rewardGranted: true,
            questionCreated: true,
            questionAlreadyExists: false,
            questionStatus: 'approved',
            reviewLink: 'https://admin.ivrm.jp/daily-quiz-reviews',
          },
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  function makeContext(dmSend: ReturnType<typeof vi.fn>) {
    return {
      guildId,
      config: { enabled: true, opsChannelId, approverRoleIds: [approverRoleId] },
      client: {
        channels: { fetch: async () => null },
        users: {
          fetch: async (userId: string) =>
            userId === '333333333333333333' ? { send: dmSend } : null,
        },
      },
    } as unknown as Parameters<typeof handleSubmissionReviewComponent>[0];
  }

  function makeInteraction(overrides: Record<string, unknown>) {
    return {
      guildId,
      user: { id: operatorId },
      member: { roles: [approverRoleId] },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      showModal: vi.fn(async () => {}),
      ...overrides,
    } as unknown as Parameters<typeof handleSubmissionReviewComponent>[1] & {
      reply: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      showModal: ReturnType<typeof vi.fn>;
    };
  }

  it('承認ロールが無いと API を呼ばずに拒否する', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({
      customId: 'dqr:approve:dqs_1',
      member: { roles: [] },
    });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(String(interaction.reply.mock.calls[0]?.[0]?.content)).toContain('専用ロールが必要');
    expect(calls).toHaveLength(0);
  });

  it('承認（5.0pt）ボタンで複合承認を呼び、元メッセージを処理済みに更新し DM する', async () => {
    const calls = setupFetch();
    const dmSend = vi.fn(async () => {});
    const interaction = makeInteraction({ customId: 'dqr:approve:dqs_1' });
    await handleSubmissionReviewComponent(makeContext(dmSend), interaction);
    const approveCalls = calls.filter((call) => call.url.endsWith('/review/bot/daily/approve'));
    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]?.body).toMatchObject({
      submissionId: 'dqs_1',
      rewardPoints: 5,
      approverRoleVerified: true,
      discordUserId: operatorId,
    });
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(interaction.update).toHaveBeenCalledTimes(1);
    const updated = interaction.update.mock.calls[0]?.[0] as {
      embeds: unknown[];
      components: unknown[];
    };
    expect(updated.components).toEqual([]);
    expect(JSON.stringify(updated.embeds)).toContain('5.0 pt');
  });

  it('金額指定ボタンはモーダルを開くだけで API を呼ばない', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({ customId: 'thr:approve-custom:the_1' });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0]?.[0] as { custom_id?: string };
    expect(modal.custom_id).toBe('thr:approve-submit:the_1');
    expect(calls).toHaveLength(0);
  });

  it('金額モーダルの送信で指定額が API に渡る', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({
      customId: 'dqr:approve-submit:dqs_1',
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => '7.5' },
    });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    const approveCalls = calls.filter((call) => call.url.endsWith('/review/bot/daily/approve'));
    expect(approveCalls[0]?.body).toMatchObject({ rewardPoints: 7.5 });
    // モーダル経由は元メッセージを更新できないため新規 ephemeral で返す
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('金額モーダルの刻み違反はローカルで弾き、承認 API を呼ばない', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({
      customId: 'dqr:approve-submit:dqs_1',
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => '7.3' },
    });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(String(interaction.reply.mock.calls[0]?.[0]?.content)).toContain('0.5 pt 刻み');
    expect(calls.filter((call) => call.url.includes('/approve'))).toHaveLength(0);
  });

  it('差し戻しモーダルの送信で理由つきで呼び、DM する', async () => {
    const calls = setupFetch();
    const dmSend = vi.fn(async () => {});
    const interaction = makeInteraction({
      customId: 'dqr:return-submit:dqs_1',
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => '選択肢が重複しています' },
    });
    await handleSubmissionReviewComponent(makeContext(dmSend), interaction);
    const returnCalls = calls.filter((call) => call.url.endsWith('/review/bot/daily/return'));
    expect(returnCalls).toHaveLength(1);
    expect(returnCalls[0]?.body).toMatchObject({
      submissionId: 'dqs_1',
      reason: '選択肢が重複しています',
    });
    expect(dmSend).toHaveBeenCalledTimes(1);
  });

  it('自己審査 403 は分かりやすい文面で返る', async () => {
    setupFetch({
      approveStatus: 403,
      approveData: { status: 'error', code: 'today_history_self_review' },
    });
    const interaction = makeInteraction({ customId: 'thr:approve:the_1' });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(String(interaction.reply.mock.calls[0]?.[0]?.content)).toContain(
      '自分の申請は審査できません',
    );
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('状況確認は pending に無ければ処理済みの可能性を返す', async () => {
    setupFetch();
    const interaction = makeInteraction({ customId: 'thr:status:the_1' });
    await handleSubmissionReviewComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(String(interaction.reply.mock.calls[0]?.[0]?.content)).toContain('審査待ちにありません');
  });
});

describe('runSubmissionReviewCycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['IVRM_WEB_API_BASE_URL'];
    delete process.env['HERTA_REVIEW_BOT_SECRET'];
  });

  const nowMs = Date.parse('2026-11-25T02:00:00.000Z');

  function setupFetch(items: unknown[]) {
    process.env['IVRM_WEB_API_BASE_URL'] = 'https://api.example.test';
    process.env['HERTA_REVIEW_BOT_SECRET'] = 'test-secret';
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });
      if (url.endsWith('/review/bot/pending')) {
        return { ok: true, status: 200, json: async () => ({ items }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  function pendingEntry(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'daily_quiz',
      id: 'dqs_1',
      state: 'submitted',
      authorDisplayName: 'member-a',
      authorDiscordUserId: '333333333333333333',
      submittedAt: '2026-11-25T00:00:00.000Z',
      reviewLink: 'https://admin.ivrm.jp/daily-quiz-reviews',
      quiz: {
        question: '日本の首都はどこ？',
        choices: ['大阪', '東京', '名古屋', '福岡'],
        correctChoiceIndex: 1,
        category: 'quiz',
      },
      ...overrides,
    };
  }

  function makeContext(options: {
    guildIdSuffix: string;
    config?: Record<string, unknown>;
    history?: unknown[];
    send: ReturnType<typeof vi.fn>;
  }) {
    const channel = {
      guildId: `guild-${options.guildIdSuffix}`,
      isTextBased: () => true,
      send: options.send,
      messages: {
        fetch: async () => ({ values: () => (options.history ?? []).values() }),
      },
    };
    return {
      guildId: `guild-${options.guildIdSuffix}`,
      config: options.config ?? {
        enabled: true,
        opsChannelId,
        approverRoleIds: [approverRoleId],
      },
      client: {
        user: { id: botUserId },
        channels: { fetch: async () => channel },
        users: { fetch: async () => null },
        guilds: {
          fetch: async () => ({
            roles: {
              fetch: async (roleId: string) =>
                roleId === approverRoleId ? { members: new Map([[operatorId, {}]]) } : null,
            },
          }),
        },
      },
    } as unknown as Parameters<typeof runSubmissionReviewCycle>[0];
  }

  it('新規申請を1件1メッセージ・ボタン付き・メンションなしで通知する', async () => {
    const calls = setupFetch([pendingEntry()]);
    const send = vi.fn(async (_options: unknown) => {});
    await runSubmissionReviewCycle(makeContext({ guildIdSuffix: 'new', send }), nowMs);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as unknown as {
      embeds: unknown[];
      components: unknown[];
      allowedMentions: { parse: [] };
    };
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(payload.embeds)).toContain('申請ID: dqs_1');
    expect(JSON.stringify(payload.components)).toContain('dqr:approve:dqs_1');
    expect(calls[0]?.body).toMatchObject({
      discordUserId: operatorId,
      approverRoleVerified: true,
    });
  });

  it('直近24時間に通知済みなら再送しない', async () => {
    setupFetch([pendingEntry()]);
    const send = vi.fn(async () => {});
    const history = [
      {
        author: { id: botUserId },
        createdTimestamp: nowMs - 60 * 60 * 1000,
        embeds: [{ fields: [{ name: '申請情報', value: '申請ID: dqs_1\n種別キー: dqr:dqs_1' }] }],
      },
    ];
    await runSubmissionReviewCycle(makeContext({ guildIdSuffix: 'recent', send, history }), nowMs);
    expect(send).not.toHaveBeenCalled();
  });

  it('最終通知から24時間以上でリマインドを再送する', async () => {
    setupFetch([pendingEntry()]);
    const send = vi.fn(async (_options: unknown) => {});
    const history = [
      {
        author: { id: botUserId },
        createdTimestamp: nowMs - 25 * 60 * 60 * 1000,
        embeds: [{ fields: [{ name: '申請情報', value: '申請ID: dqs_1\n種別キー: dqr:dqs_1' }] }],
      },
    ];
    await runSubmissionReviewCycle(makeContext({ guildIdSuffix: 'remind', send, history }), nowMs);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as unknown as { embeds: { title?: string }[] };
    expect(payload.embeds[0]?.title).toContain('リマインド');
  });

  it('チャンネル未設定なら API も呼ばず無効のまま動く', async () => {
    const calls = setupFetch([pendingEntry()]);
    const send = vi.fn(async () => {});
    await runSubmissionReviewCycle(
      makeContext({
        guildIdSuffix: 'nochan',
        send,
        config: { enabled: true, approverRoleIds: [approverRoleId] },
      }),
      nowMs,
    );
    expect(calls).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('探索できなくても、操作で検証済みの運営者の記憶で取得できる', async () => {
    const calls = setupFetch([pendingEntry()]);
    const send = vi.fn(async () => {});
    const context = makeContext({ guildIdSuffix: 'remembered', send });
    rememberSubmissionReviewOperator('guild-remembered', operatorId);
    (context.client as { guilds?: unknown }).guilds = undefined;
    await runSubmissionReviewCycle(context, nowMs);
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls[0]?.body).toMatchObject({ discordUserId: operatorId });
  });
});
