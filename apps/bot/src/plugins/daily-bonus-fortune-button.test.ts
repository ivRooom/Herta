import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dailyBonusButtonRow } from './daily-bonus-buttons.js';

const mocks = vi.hoisted(() => ({
  announcement: vi.fn(),
  fortune: vi.fn(),
}));
vi.mock('@herta/db', () => ({ getDailyAnnouncement: mocks.announcement }));
vi.mock('./daily-participation-fortune.js', () => ({
  participationFortune: mocks.fortune,
}));
import {
  handleDailyBonusFortune,
  isDailyBonusFortuneButton,
} from './daily-bonus-fortune-button.js';

const guildId = '123456789012345678';
const userId = '223456789012345678';
const roleId = '323456789012345678';
const channelId = '423456789012345678';
const messageId = '523456789012345678';
const date = '2026-10-31';

function context(fortuneEnabled = true) {
  return {
    guildId,
    prisma: {},
    client: { user: { id: 'bot' } },
    config: { enabled: true, notificationRoleId: roleId, fortuneEnabled },
  } as unknown as Parameters<typeof handleDailyBonusFortune>[0];
}

function interaction(customId = `daily-bonus:fortune:${date}`) {
  return {
    customId,
    guildId,
    channelId,
    user: { id: userId },
    message: { id: messageId },
    guild: {
      members: {
        fetch: vi.fn(async () => ({ roles: { cache: new Map([[roleId, {}]]) } })),
      },
      channels: {
        fetch: vi.fn(async () => ({
          isTextBased: () => true,
          messages: { fetch: vi.fn(async () => ({ author: { id: 'bot' } })) },
        })),
      },
    },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
  } as unknown as Parameters<typeof handleDailyBonusFortune>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T02:00:00Z'));
  vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
  mocks.announcement.mockResolvedValue({
    message_id: messageId,
    role_id: roleId,
    channel_id: channelId,
    status: 'sent',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('shows the three requested buttons only when their independent handlers are enabled', () => {
  const ids = (participationEnabled: boolean, fortuneEnabled: boolean) =>
    dailyBonusButtonRow(date, { participationEnabled, fortuneEnabled })
      .components.map((button) => button.toJSON())
      .map((button) => ('custom_id' in button ? button.custom_id : undefined));
  expect(ids(true, true)).toEqual([
    `daily-bonus:${date}`,
    `daily-participation:questions:${date}`,
    `daily-bonus:fortune:${date}`,
  ]);
  expect(ids(false, true)).toEqual([
    `daily-bonus:${date}`,
    `daily-bonus:fortune:${date}`,
  ]);
  expect(ids(false, false)).toEqual([`daily-bonus:${date}`]);
});

it('only routes an exact fortune button ID', () => {
  expect(isDailyBonusFortuneButton(`daily-bonus:fortune:${date}`)).toBe(true);
  expect(isDailyBonusFortuneButton(`daily-bonus:${date}`)).toBe(false);
  expect(isDailyBonusFortuneButton(`daily-bonus:fortune:${date}:extra`)).toBe(false);
});

it('opens a private fortune without calling any claim or mutating the wallet', async () => {
  const ctx = context();
  const i = interaction();
  await handleDailyBonusFortune(ctx, i);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
  expect(i.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ allowedMentions: { parse: [] } }),
  );
  expect(mocks.fortune).toHaveBeenCalledTimes(1);
  expect(mocks.fortune).toHaveBeenCalledWith(ctx, i, date);
});

it('rejects a disabled fortune feature without reading an announcement', async () => {
  const i = interaction();
  await handleDailyBonusFortune(context(false), i);
  expect(mocks.announcement).not.toHaveBeenCalled();
  expect(mocks.fortune).not.toHaveBeenCalled();
});

it('rejects a foreign guild and role before displaying any fortune', async () => {
  const i = interaction();
  Object.assign(i, { guildId: '923456789012345678' });
  await handleDailyBonusFortune(context(), i);
  expect(mocks.fortune).not.toHaveBeenCalled();

  const j = interaction();
  j.guild!.members.fetch = vi.fn(async () => ({ roles: { cache: new Map() } })) as never;
  await handleDailyBonusFortune(context(), j);
  expect(mocks.fortune).not.toHaveBeenCalled();
});

it('rejects stale date and mismatched announcement', async () => {
  vi.setSystemTime(new Date('2026-11-01T02:00:00Z'));
  await handleDailyBonusFortune(context(), interaction());
  expect(mocks.fortune).not.toHaveBeenCalled();

  vi.setSystemTime(new Date('2026-10-31T02:00:00Z'));
  mocks.announcement.mockResolvedValueOnce({
    message_id: '623456789012345678',
    role_id: roleId,
    channel_id: channelId,
    status: 'sent',
  });
  await handleDailyBonusFortune(context(), interaction());
  expect(mocks.fortune).not.toHaveBeenCalled();
});

it('rejects a foreign author or runtime generation change', async () => {
  const i = interaction();
  i.guild!.channels.fetch = vi.fn(async () => ({
    isTextBased: () => true,
    messages: { fetch: vi.fn(async () => ({ author: { id: 'foreign' } })) },
  })) as never;
  await handleDailyBonusFortune(context(), i);
  expect(mocks.fortune).not.toHaveBeenCalled();

  const j = interaction();
  let count = 0;
  await handleDailyBonusFortune(context(), j, () => ++count === 1);
  expect(mocks.fortune).not.toHaveBeenCalled();
});

it('fails closed when the bonus runtime flag is off', async () => {
  vi.stubEnv('DAILY_BONUS_ENABLED', 'false');
  await handleDailyBonusFortune(context(), interaction());
  expect(mocks.announcement).not.toHaveBeenCalled();
  expect(mocks.fortune).not.toHaveBeenCalled();
});
