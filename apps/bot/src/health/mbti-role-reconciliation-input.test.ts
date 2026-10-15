import { describe, expect, it } from 'vitest';
import { parseMbtiRoleReconciliationInput } from './mbti-role-reconciliation-input.js';

const USER_ID = '123456789012345678';

describe('parseMbtiRoleReconciliationInput', () => {
  it('17〜20桁のdiscordUserIdと16タイプのresultTypeだけを受け付ける', () => {
    expect(
      parseMbtiRoleReconciliationInput({ discordUserId: ` ${USER_ID} `, resultType: 'INTJ' }),
    ).toEqual({ discordUserId: USER_ID, resultType: 'INTJ' });
  });

  it('discordUserIdの形式が不正な場合はnullを返す', () => {
    expect(
      parseMbtiRoleReconciliationInput({ discordUserId: 'not-an-id', resultType: 'INTJ' }),
    ).toBeNull();
    expect(
      parseMbtiRoleReconciliationInput({ discordUserId: '123', resultType: 'INTJ' }),
    ).toBeNull();
  });

  it('未知のresultTypeはnullを返す', () => {
    expect(
      parseMbtiRoleReconciliationInput({ discordUserId: USER_ID, resultType: 'XXXX' }),
    ).toBeNull();
    expect(parseMbtiRoleReconciliationInput({ discordUserId: USER_ID, resultType: '' })).toBeNull();
  });

  it('オブジェクト以外や必須フィールド欠落はnullを返す', () => {
    expect(parseMbtiRoleReconciliationInput(null)).toBeNull();
    expect(parseMbtiRoleReconciliationInput([])).toBeNull();
    expect(parseMbtiRoleReconciliationInput({ discordUserId: USER_ID })).toBeNull();
    expect(parseMbtiRoleReconciliationInput({ resultType: 'INTJ' })).toBeNull();
  });
});
