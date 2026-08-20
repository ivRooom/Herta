import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBirthdayCardPreviewSelection,
  getBirthdayCardPreviewSelectionForPathname,
  setBirthdayCardPreviewSelection,
} from './birthday-card-preview-selection.ts';

test('Birthday Card preview selectionを設定・解除できる', () => {
  setBirthdayCardPreviewSelection({
    guildId: '111111111111111111',
    userId: '222222222222222222',
  });
  assert.deepEqual(getBirthdayCardPreviewSelection(), {
    guildId: '111111111111111111',
    userId: '222222222222222222',
  });

  setBirthdayCardPreviewSelection(null);
  assert.equal(getBirthdayCardPreviewSelection(), null);
});

test('現在のBirthday pageと同じGuildのselectionだけを返す', () => {
  setBirthdayCardPreviewSelection({
    guildId: '111111111111111111',
    userId: '222222222222222222',
  });

  assert.deepEqual(
    getBirthdayCardPreviewSelectionForPathname(
      '/dashboard/guilds/111111111111111111/birthday',
    ),
    {
      guildId: '111111111111111111',
      userId: '222222222222222222',
    },
  );
  assert.equal(
    getBirthdayCardPreviewSelectionForPathname(
      '/dashboard/guilds/333333333333333333/birthday',
    ),
    null,
  );
  assert.equal(getBirthdayCardPreviewSelectionForPathname('/dashboard'), null);

  setBirthdayCardPreviewSelection(null);
});
