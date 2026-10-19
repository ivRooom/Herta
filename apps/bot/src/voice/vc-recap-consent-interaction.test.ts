import { describe, expect, it } from 'vitest';
import { CONSENT_CUSTOM_ID_PREFIX, parseConsentCustomId } from './vc-recap-consent-interaction.js';

describe('parseConsentCustomId', () => {
  it('yes/noとuserIdを正しく抽出する', () => {
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}yes:123456789012345678`)).toEqual({
      action: 'yes',
      userId: '123456789012345678',
    });
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}no:123456789012345678`)).toEqual({
      action: 'no',
      userId: '123456789012345678',
    });
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}web:123456789012345678`)).toEqual({
      action: 'web',
      userId: '123456789012345678',
    });
  });

  it('プレフィックスが一致しない場合はnullを返す', () => {
    expect(parseConsentCustomId('herta:other:v1:yes:123456789012345678')).toBeNull();
  });

  it('actionがyes/no以外の場合はnullを返す', () => {
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}maybe:123456789012345678`)).toBeNull();
  });

  it('userIdがDiscord snowflake形式でない場合はnullを返す', () => {
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}yes:not-a-snowflake`)).toBeNull();
    expect(parseConsentCustomId(`${CONSENT_CUSTOM_ID_PREFIX}yes:`)).toBeNull();
  });
});
