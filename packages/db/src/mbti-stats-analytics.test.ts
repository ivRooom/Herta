import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisPercentFromAverageScore,
  isKnownMbtiResultType,
  normalizeMbtiQuizCompletionInput,
} from './mbti-stats-analytics.js';

test('axisPercentFromAverageScoreは平均スコア0を50%に変換する', () => {
  assert.equal(axisPercentFromAverageScore('EI', 0), 50);
});

test('axisPercentFromAverageScoreは最大スコアを100%に変換する', () => {
  assert.equal(axisPercentFromAverageScore('EI', 26), 100);
  assert.equal(axisPercentFromAverageScore('TF', 24), 100);
});

test('axisPercentFromAverageScoreは最小スコアを0%に変換する', () => {
  assert.equal(axisPercentFromAverageScore('EI', -26), 0);
});

test('axisPercentFromAverageScoreは範囲外の値を0〜100にクランプする', () => {
  assert.equal(axisPercentFromAverageScore('JP', 999), 100);
  assert.equal(axisPercentFromAverageScore('JP', -999), 0);
});

test('既知の16タイプはisKnownMbtiResultTypeでtrueになる', () => {
  assert.equal(isKnownMbtiResultType('INTJ'), true);
  assert.equal(isKnownMbtiResultType('ESFP'), true);
});

test('未知の文字列はisKnownMbtiResultTypeでfalseになる', () => {
  assert.equal(isKnownMbtiResultType('XXXX'), false);
  assert.equal(isKnownMbtiResultType(''), false);
});

test('正常な入力を正規化してcompletionIdを付与する', () => {
  const normalized = normalizeMbtiQuizCompletionInput(
    {
      guildId: ' 1234567890 ',
      resultType: 'INFP',
      eiScore: 10,
      snScore: -8,
      tfScore: 0,
      jpScore: 5,
      answers: [{ questionIndex: 0, axis: 'EI', answer: 'agree' }],
    },
    'completion-1',
  );

  assert.deepEqual(normalized, {
    completionId: 'completion-1',
    guildId: '1234567890',
    resultType: 'INFP',
    eiScore: 10,
    snScore: -8,
    tfScore: 0,
    jpScore: 5,
    answers: [{ questionIndex: 0, axis: 'EI', answer: 'agree' }],
  });
});

test('未知のresultTypeは例外を投げる', () => {
  assert.throws(() =>
    normalizeMbtiQuizCompletionInput(
      {
        guildId: 'guild-1',
        resultType: 'XXXX',
        eiScore: 0,
        snScore: 0,
        tfScore: 0,
        jpScore: 0,
        answers: [],
      },
      'completion-2',
    ),
  );
});

test('空のguildIdは安全な代替値へ変換する', () => {
  const normalized = normalizeMbtiQuizCompletionInput(
    {
      guildId: '   ',
      resultType: 'ENTJ',
      eiScore: 0,
      snScore: 0,
      tfScore: 0,
      jpScore: 0,
      answers: [],
    },
    'completion-3',
  );

  assert.equal(normalized.guildId, 'unknown-guild');
});

test('スコアは-30〜30にクランプされる', () => {
  const normalized = normalizeMbtiQuizCompletionInput(
    {
      guildId: 'guild-1',
      resultType: 'ISTP',
      eiScore: 999,
      snScore: -999,
      tfScore: Number.NaN,
      jpScore: 12.6,
      answers: [],
    },
    'completion-4',
  );

  assert.equal(normalized.eiScore, 30);
  assert.equal(normalized.snScore, -30);
  assert.equal(normalized.tfScore, 0);
  assert.equal(normalized.jpScore, 13);
});

test('不正なaxis/answerを含む回答は除外される', () => {
  const normalized = normalizeMbtiQuizCompletionInput(
    {
      guildId: 'guild-1',
      resultType: 'ISFJ',
      eiScore: 0,
      snScore: 0,
      tfScore: 0,
      jpScore: 0,
      answers: [
        { questionIndex: 0, axis: 'EI', answer: 'agree' },
        // @ts-expect-error 不正な値を意図的に渡して除外されることを確認する
        { questionIndex: 1, axis: 'ZZ', answer: 'agree' },
        // @ts-expect-error 不正な値を意図的に渡して除外されることを確認する
        { questionIndex: 2, axis: 'SN', answer: 'maybe' },
      ],
    },
    'completion-5',
  );

  assert.deepEqual(normalized.answers, [{ questionIndex: 0, axis: 'EI', answer: 'agree' }]);
});

test('questionIndexは0〜99にクランプされる', () => {
  const normalized = normalizeMbtiQuizCompletionInput(
    {
      guildId: 'guild-1',
      resultType: 'ESTP',
      eiScore: 0,
      snScore: 0,
      tfScore: 0,
      jpScore: 0,
      answers: [{ questionIndex: -5, axis: 'JP', answer: 'neutral' }],
    },
    'completion-6',
  );

  assert.equal(normalized.answers[0]?.questionIndex, 0);
});
