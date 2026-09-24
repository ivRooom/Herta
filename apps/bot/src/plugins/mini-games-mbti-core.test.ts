import { describe, expect, it } from 'vitest';
import {
  MBTI_AXES,
  MBTI_QUESTIONS,
  MBTI_TYPES,
  computeMbtiType,
  createEmptyMbtiScores,
} from './mini-games-mbti-core.js';

describe('Mini Games MBTI core', () => {
  it('各軸ちょうど3問ずつ、計12問を定義する', () => {
    expect(MBTI_QUESTIONS).toHaveLength(12);
    for (const axis of MBTI_AXES) {
      expect(MBTI_QUESTIONS.filter((question) => question.axis === axis)).toHaveLength(3);
    }
  });

  it('全問正方向で回答するとENTJ寄りの英字4文字(EかSかTかJのみ)になる', () => {
    const scores = createEmptyMbtiScores();
    for (const axis of MBTI_AXES) scores[axis] = 3;
    expect(computeMbtiType(scores)).toBe('ESTJ');
  });

  it('全問負方向で回答するとINFPになる', () => {
    const scores = createEmptyMbtiScores();
    for (const axis of MBTI_AXES) scores[axis] = -3;
    expect(computeMbtiType(scores)).toBe('INFP');
  });

  it('奇数問(3問)構成のためscoreの合計は0にならずタイブレークが発生しない', () => {
    for (const axis of MBTI_AXES) {
      const questionCount = MBTI_QUESTIONS.filter((question) => question.axis === axis).length;
      expect(questionCount % 2).toBe(1);
    }
  });

  it('score 0(未回答)はEIS...寄りの既定側(正方向)として扱う', () => {
    expect(computeMbtiType(createEmptyMbtiScores())).toBe('ESTJ');
  });

  it('16タイプすべてにtitleとdescriptionが定義されている', () => {
    const allTypes = [
      'INTJ',
      'INTP',
      'ENTJ',
      'ENTP',
      'INFJ',
      'INFP',
      'ENFJ',
      'ENFP',
      'ISTJ',
      'ISFJ',
      'ESTJ',
      'ESFJ',
      'ISTP',
      'ISFP',
      'ESTP',
      'ESFP',
    ];
    expect(Object.keys(MBTI_TYPES).sort()).toEqual(allTypes.sort());
    for (const type of allTypes) {
      expect(MBTI_TYPES[type]?.title).toBeTruthy();
      expect(MBTI_TYPES[type]?.description).toBeTruthy();
    }
  });
});
