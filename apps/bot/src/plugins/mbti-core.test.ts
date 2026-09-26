import { describe, expect, it } from 'vitest';
import {
  MBTI_AXES,
  MBTI_AXIS_QUESTION_COUNTS,
  MBTI_LIKERT_ANSWERS,
  MBTI_QUESTION_POOL,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  mbtiLikertWeight,
  selectMbtiQuestions,
} from './mbti-core.js';

describe('Mini Games MBTI core', () => {
  it('出題プールは計100問を4軸(EI/SN/TF/JP)へ26/26/24/24で分配して定義する', () => {
    expect(MBTI_QUESTION_POOL).toHaveLength(100);
    expect(MBTI_QUESTION_POOL.filter((question) => question.axis === 'EI')).toHaveLength(26);
    expect(MBTI_QUESTION_POOL.filter((question) => question.axis === 'SN')).toHaveLength(26);
    expect(MBTI_QUESTION_POOL.filter((question) => question.axis === 'TF')).toHaveLength(24);
    expect(MBTI_QUESTION_POOL.filter((question) => question.axis === 'JP')).toHaveLength(24);
  });

  it('プール内のidは0始まりの連番でユニークである', () => {
    const ids = MBTI_QUESTION_POOL.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(0);
    expect(ids.at(-1)).toBe(MBTI_QUESTION_POOL.length - 1);
  });

  it('MBTI_AXIS_QUESTION_COUNTSの合計は50問(1回の診断の出題数)になる', () => {
    const total = MBTI_AXES.reduce((sum, axis) => sum + MBTI_AXIS_QUESTION_COUNTS[axis], 0);
    expect(total).toBe(50);
  });

  it('selectMbtiQuestionsは各軸MBTI_AXIS_QUESTION_COUNTS分・計50問を重複なく抽出する', () => {
    const selected = selectMbtiQuestions(() => 0.5);
    expect(selected).toHaveLength(50);
    const ids = selected.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const axis of MBTI_AXES) {
      expect(selected.filter((question) => question.axis === axis)).toHaveLength(
        MBTI_AXIS_QUESTION_COUNTS[axis],
      );
    }
  });

  it('selectMbtiQuestionsはrandomの結果に応じて異なる設問集合・順序を返す', () => {
    let callCount = 0;
    const sequenceA = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05];
    const randomA = () => sequenceA[callCount++ % sequenceA.length]!;
    callCount = 0;
    const selectedA = selectMbtiQuestions(randomA);

    let callCount2 = 0;
    const sequenceB = [0.9, 0.05, 0.15, 0.85, 0.25, 0.75, 0.35, 0.65, 0.45, 0.55];
    const randomB = () => sequenceB[callCount2++ % sequenceB.length]!;
    const selectedB = selectMbtiQuestions(randomB);

    const idsA = selectedA.map((question) => question.id).join(',');
    const idsB = selectedB.map((question) => question.id).join(',');
    expect(idsA).not.toBe(idsB);
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
