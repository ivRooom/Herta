import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BIRTHDAY_CARD_CONFIG } from '@herta/shared';
import {
  birthdayCardDirtyFieldKeys,
  restoreBirthdayCardEditableConfig,
} from './birthday-card-editor-state.ts';

test('dirty fieldは編集可能なBirthday Card項目だけを返す', () => {
  const saved = { ...DEFAULT_BIRTHDAY_CARD_CONFIG };
  const current = {
    ...saved,
    birthdayCardNameX: 24,
    birthdayCardAgeX: 18,
  };
  const editable = new Set(['birthdayCardNameX']);

  assert.deepEqual(birthdayCardDirtyFieldKeys(current, saved, editable), ['birthdayCardNameX']);
});

test('resetは編集可能な未保存変更だけを保存済み値へ戻す', () => {
  const saved = { ...DEFAULT_BIRTHDAY_CARD_CONFIG };
  const current = {
    ...saved,
    birthdayCardEnabled: !saved.birthdayCardEnabled,
    birthdayCardAvatarSize: 22,
    birthdayCardAgeX: 18,
  };
  const editable = new Set(['birthdayCardEnabled', 'birthdayCardAvatarSize']);

  const restored = restoreBirthdayCardEditableConfig(current, saved, editable);

  assert.equal(restored.birthdayCardEnabled, saved.birthdayCardEnabled);
  assert.equal(restored.birthdayCardAvatarSize, saved.birthdayCardAvatarSize);
  assert.equal(restored.birthdayCardAgeX, 18);
  assert.equal(current.birthdayCardAvatarSize, 22);
});

test('編集可能項目がない場合は設定値を変更しない', () => {
  const saved = { ...DEFAULT_BIRTHDAY_CARD_CONFIG };
  const current = {
    ...saved,
    birthdayCardNameY: 12,
  };

  assert.deepEqual(restoreBirthdayCardEditableConfig(current, saved, new Set()), current);
  assert.deepEqual(birthdayCardDirtyFieldKeys(current, saved, new Set()), []);
});
