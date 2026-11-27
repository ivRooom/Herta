import { describe, expect, it } from 'vitest';
import { parseManualBirthdayDeliveryInput } from './manual-birthday-delivery-input.js';

describe('parseManualBirthdayDeliveryInput', () => {
  it('正しい入力を受け付ける', () => {
    expect(
      parseManualBirthdayDeliveryInput({
        discordUserId: '222222222222222222',
        localDate: '2026-11-22',
      }),
    ).toEqual({ discordUserId: '222222222222222222', localDate: '2026-11-22' });
  });

  it('ユーザーIDの形式が不正なら拒否する', () => {
    expect(
      parseManualBirthdayDeliveryInput({ discordUserId: 'abc', localDate: '2026-11-22' }),
    ).toBeNull();
    expect(
      parseManualBirthdayDeliveryInput({ discordUserId: '12345', localDate: '2026-11-22' }),
    ).toBeNull();
    expect(parseManualBirthdayDeliveryInput({ localDate: '2026-11-22' })).toBeNull();
  });

  it('実在しない日付や形式の異なる日付は拒否する', () => {
    expect(
      parseManualBirthdayDeliveryInput({
        discordUserId: '222222222222222222',
        localDate: '2026-02-30',
      }),
    ).toBeNull();
    expect(
      parseManualBirthdayDeliveryInput({
        discordUserId: '222222222222222222',
        localDate: '2026/11/22',
      }),
    ).toBeNull();
    expect(
      parseManualBirthdayDeliveryInput({
        discordUserId: '222222222222222222',
        localDate: '2026-11-22T00:00:00Z',
      }),
    ).toBeNull();
  });

  it('オブジェクトでない入力は拒否する', () => {
    expect(parseManualBirthdayDeliveryInput(null)).toBeNull();
    expect(parseManualBirthdayDeliveryInput('x')).toBeNull();
    expect(parseManualBirthdayDeliveryInput([])).toBeNull();
  });
});
