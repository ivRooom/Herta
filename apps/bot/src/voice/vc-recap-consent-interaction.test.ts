import { describe, expect, it } from 'vitest';
import {
  CONSENT_CUSTOM_ID_PREFIX,
  buildConsentActionRow,
  parseConsentCustomId,
} from './vc-recap-consent-interaction.js';

const USER_ID = '123456789012345678';

describe('parseConsentCustomId', () => {
  it('yes/no/webとuserIdを正しく抽出する', () => {
    expect(parseConsentCustomId(`herta:consent:v2:yes:${USER_ID}`)).toEqual({
      action: 'yes',
      userId: USER_ID,
      transcriptRetention: true,
    });
    expect(parseConsentCustomId(`herta:consent:v2:no:${USER_ID}`)).toEqual({
      action: 'no',
      userId: USER_ID,
      transcriptRetention: true,
    });
    expect(parseConsentCustomId(`herta:consent:v2:web:${USER_ID}`)).toEqual({
      action: 'web',
      userId: USER_ID,
      transcriptRetention: true,
    });
  });

  it('本文保存を説明する前のv1ボタンは本文保存の同意として扱わない', () => {
    expect(parseConsentCustomId(`herta:consent:v1:yes:${USER_ID}`)).toEqual({
      action: 'yes',
      userId: USER_ID,
      transcriptRetention: false,
    });
  });

  it('新しく作るボタンはv2で、振り分け用プレフィックスに一致する', () => {
    const customIds = buildConsentActionRow(USER_ID).components.map(
      (button) => (button.toJSON() as { custom_id: string }).custom_id,
    );
    expect(customIds).toEqual([
      `herta:consent:v2:yes:${USER_ID}`,
      `herta:consent:v2:no:${USER_ID}`,
      `herta:consent:v2:web:${USER_ID}`,
    ]);
    expect(customIds.every((id) => id.startsWith(CONSENT_CUSTOM_ID_PREFIX))).toBe(true);
  });

  it('プレフィックスが一致しない場合はnullを返す', () => {
    expect(parseConsentCustomId(`herta:other:v1:yes:${USER_ID}`)).toBeNull();
  });

  it('未知のバージョンはnullを返す', () => {
    expect(parseConsentCustomId(`herta:consent:v9:yes:${USER_ID}`)).toBeNull();
  });

  it('actionがyes/no以外の場合はnullを返す', () => {
    expect(parseConsentCustomId(`herta:consent:v2:maybe:${USER_ID}`)).toBeNull();
  });

  it('userIdがDiscord snowflake形式でない場合はnullを返す', () => {
    expect(parseConsentCustomId('herta:consent:v2:yes:not-a-snowflake')).toBeNull();
    expect(parseConsentCustomId('herta:consent:v2:yes:')).toBeNull();
  });
});
