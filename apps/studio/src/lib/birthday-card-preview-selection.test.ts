import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBirthdayCardPreviewSelection,
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
