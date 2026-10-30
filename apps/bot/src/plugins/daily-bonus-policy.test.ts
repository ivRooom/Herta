import { describe, expect, it } from 'vitest';
import {
  dailyBonusAllowedMentions,
  dailyBonusDate,
  rejectDailyBonus,
  type DailyBonusAdmission,
} from './daily-bonus-policy.js';

const valid: DailyBonusAdmission = {
  enabled: true,
  configuredGuildId: 'guild',
  interactionGuildId: 'guild',
  configuredRoleId: 'role',
  memberRoleIds: ['role'],
  announcementMessageId: 'message',
  interactionMessageId: 'message',
  announcementDate: '2026-10-29',
  announcementStatus: 'sent',
  now: new Date('2026-10-29T09:00:00+09:00'),
};
describe('daily bonus admission', () => {
  it.each([
    ['2026-10-29T00:00:00+09:00', 'expired'],
    ['2026-10-29T08:59:59.999+09:00', 'expired'],
    ['2026-10-29T09:00:00+09:00', null],
    ['2026-10-29T23:59:59.999+09:00', null],
    ['2026-10-30T00:00:00+09:00', 'expired'],
  ])('checks JST boundary %s', (instant, rejection) => {
    expect(rejectDailyBonus({ ...valid, now: new Date(instant!) })).toBe(rejection);
  });
  it.each([
    [{ enabled: false }, 'disabled'],
    [{ interactionGuildId: null }, 'guild'],
    [{ interactionGuildId: 'other' }, 'guild'],
    [{ memberRoleIds: [] }, 'role'],
    [{ interactionMessageId: 'forged' }, 'message'],
    [{ announcementStatus: 'disabled' }, 'message'],
    [{ now: new Date(NaN) }, 'expired'],
  ] as const)('rejects invalid server context', (override, rejection) => {
    expect(rejectDailyBonus({ ...valid, ...override })).toBe(rejection);
  });
  it('rolls the date over at JST midnight', () => {
    expect(dailyBonusDate(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
  it('permits only the dedicated role', () => {
    expect(dailyBonusAllowedMentions('1565130164386398403')).toEqual({
      parse: [],
      roles: ['1565130164386398403'],
      users: [],
      repliedUser: false,
    });
    expect(() => dailyBonusAllowedMentions('@everyone')).toThrow();
  });
});
