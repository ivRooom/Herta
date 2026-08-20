import assert from 'node:assert/strict';
import test from 'node:test';
import {
  birthdayCardPreviewInitials,
  birthdayCardPreviewSubject,
} from './birthday-card-preview-subject.ts';

test('sample subjectを既存Birthday Card表示へ正規化する', () => {
  assert.deepEqual(birthdayCardPreviewSubject(), {
    displayName: 'Herta Member',
    avatarUrl: null,
    birthdayText: '8月19日',
    ageText: '25歳',
    initials: 'HM',
  });
});

test('実メンバーの表示名・Avatar・誕生日・年齢を利用する', () => {
  assert.deepEqual(
    birthdayCardPreviewSubject({
      userId: '123456789012345678',
      displayName: 'Herta User',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123/hash.png',
      birthday: { month: 8, day: 20, age: 26 },
    }),
    {
      displayName: 'Herta User',
      avatarUrl: 'https://cdn.discordapp.com/avatars/123/hash.png',
      birthdayText: '8月20日',
      ageText: '26歳',
      initials: 'HU',
    },
  );
});

test('誕生日・生年未登録状態をライブプレビューと同じ文言で表す', () => {
  assert.equal(
    birthdayCardPreviewSubject({
      userId: '123456789012345678',
      displayName: 'メンバー',
      avatarUrl: null,
      birthday: null,
    }).birthdayText,
    '誕生日未登録',
  );
  assert.equal(
    birthdayCardPreviewSubject({
      userId: '123456789012345678',
      displayName: 'メンバー',
      avatarUrl: null,
      birthday: { month: 1, day: 2, age: null },
    }).ageText,
    '年齢未登録',
  );
});

test('initialsはUnicode文字を壊さず最大2文字へ正規化する', () => {
  assert.equal(birthdayCardPreviewInitials('Alice Bob'), 'AB');
  assert.equal(birthdayCardPreviewInitials('ヘルタ'), 'ヘル');
  assert.equal(birthdayCardPreviewInitials('  '), 'HM');
});
