import { describe, expect, it } from 'vitest';
import {
  MBTI_AXES,
  MBTI_AXIS_QUESTION_COUNTS,
  MBTI_LIKERT_ANSWERS,
  MBTI_QUESTIONS,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  mbtiLikertWeight,
} from './mbti-core.js';

describe('Mini Games MBTI core', () => {
  it('計50問を4軸(EI/SN/TF/JP)へ分配して定義する', () => {
    expect(MBTI_QUESTIONS).toHaveLength(50);
    const total = MBTI_AXES.reduce((sum, axis) => sum + MBTI_AXIS_QUESTION_COUNTS[axis], 0);
    expect(total).toBe(50);
    for (const axis of MBTI_AXES) {
      expect(MBTI_QUESTIONS.filter((question) => question.axis === axis)).toHaveLength(
        MBTI_AXIS_QUESTION_COUNTS[axis],
      );
    }
  });

  it('5段階のLikert回答値だけを受け付ける', () => {
    expect(MBTI_LIKERT_ANSWERS).toHaveLength(5);
    expect(isMbtiLikertAnswer('agree')).toBe(true);
    expect(isMbtiLikertAnswer('slightly_disagree')).toBe(true);
    expect(isMbtiLikertAnswer('strongly_agree')).toBe(false);
    expect(isMbtiLikertAnswer('')).toBe(false);
  });

  it('Likert回答値を日本語ラベルへ変換する', () => {
    expect(mbtiLikertLabel('agree')).toBe('当てはまる');
    expect(mbtiLikertLabel('neutral')).toBe('どちらでもない');
    expect(mbtiLikertLabel('disagree')).toBe('当てはまらない');
  });

  it('Likert回答値を+2〜-2の重みへ変換する', () => {
    expect(mbtiLikertWeight('agree')).toBe(2);
    expect(mbtiLikertWeight('slightly_agree')).toBe(1);
    expect(mbtiLikertWeight('neutral')).toBe(0);
    expect(mbtiLikertWeight('slightly_disagree')).toBe(-1);
    expect(mbtiLikertWeight('disagree')).toBe(-2);
  });

  it('全問agree(最大値)で回答するとESTJになる', () => {
    const scores = createEmptyMbtiScores();
    for (const axis of MBTI_AXES) scores[axis] = MBTI_AXIS_QUESTION_COUNTS[axis] * 2;
    expect(computeMbtiType(scores)).toBe('ESTJ');
  });

  it('全問disagree(最小値)で回答するとINFPになる', () => {
    const scores = createEmptyMbtiScores();
    for (const axis of MBTI_AXES) scores[axis] = -MBTI_AXIS_QUESTION_COUNTS[axis] * 2;
    expect(computeMbtiType(scores)).toBe('INFP');
  });

  it('score 0(タイ)は正方向側(E/S/T/J)として扱う', () => {
    expect(computeMbtiType(createEmptyMbtiScores())).toBe('ESTJ');
  });

  it('axisの強さを0〜100%で算出する(満点は100%、0点は50%、最低点は0%)', () => {
    const maxScores = createEmptyMbtiScores();
    maxScores.EI = MBTI_AXIS_QUESTION_COUNTS.EI * 2;
    expect(computeMbtiAxisPercent(maxScores, 'EI')).toBe(100);

    expect(computeMbtiAxisPercent(createEmptyMbtiScores(), 'EI')).toBe(50);

    const minScores = createEmptyMbtiScores();
    minScores.EI = -MBTI_AXIS_QUESTION_COUNTS.EI * 2;
    expect(computeMbtiAxisPercent(minScores, 'EI')).toBe(0);
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
