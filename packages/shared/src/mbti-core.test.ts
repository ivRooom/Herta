import { describe, expect, it } from 'vitest';
import {
  MBTI_AXES,
  MBTI_AXIS_QUESTION_COUNTS,
  MBTI_IDENTITY_INFO,
  MBTI_LIKERT_ANSWERS,
  MBTI_QUESTION_POOL,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiIdentity,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  mbtiLikertWeight,
  selectMbtiQuestions,
  scoreMbtiAnswer,
} from './mbti-core.js';

describe('Mini Games MBTI core', () => {
  it('旧124問のIDを保ち、新しい520問を追加する', () => {
    expect(MBTI_QUESTION_POOL).toHaveLength(644);
    const current = MBTI_QUESTION_POOL.filter((q) => q.facet);
    expect(current).toHaveLength(520);
    for (const axis of MBTI_AXES) {
      expect(current.filter((q) => q.axis === axis)).toHaveLength(104);
    }
    expect(MBTI_QUESTION_POOL[0]?.prompt).toBe('大人数で集まるとエネルギーが湧いてくる方だ');
    expect(MBTI_QUESTION_POOL[123]?.axis).toBe('AT');
  });

  it('プール内のidは0始まりの連番でユニークである', () => {
    const ids = MBTI_QUESTION_POOL.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(0);
    expect(ids.at(-1)).toBe(MBTI_QUESTION_POOL.length - 1);
  });

  it('MBTI_AXIS_QUESTION_COUNTSの合計は62問(1回の診断の出題数)になる', () => {
    const total = MBTI_AXES.reduce((sum, axis) => sum + MBTI_AXIS_QUESTION_COUNTS[axis], 0);
    expect(total).toBe(62);
  });

  it('selectMbtiQuestionsは各軸MBTI_AXIS_QUESTION_COUNTS分・計62問を重複なく抽出する', () => {
    const selected = selectMbtiQuestions(() => 0.5);
    expect(selected).toHaveLength(62);
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

  it('200通りの診断で観点・採点方向・固定問数のバランスを保つ', () => {
    const original = JSON.stringify(MBTI_QUESTION_POOL);
    const sets = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      let state = seed;
      const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      const questions = selectMbtiQuestions(random);
      expect(new Set(questions.map((q) => q.id)).size).toBe(62);
      sets.add(
        questions
          .map((q) => q.id)
          .sort((a, b) => a - b)
          .join(','),
      );
      for (const axis of MBTI_AXES) {
        const items = questions.filter((q) => q.axis === axis);
        expect(items).toHaveLength(MBTI_AXIS_QUESTION_COUNTS[axis]);
        const facets = new Set(items.map((q) => q.facet));
        expect(facets.size).toBe(4);
        expect(facets.has(undefined)).toBe(false);
        for (const facet of facets) {
          const subset = items.filter((q) => q.facet === facet);
          expect(subset.length).toBeGreaterThanOrEqual(3);
          expect(subset.length).toBeLessThanOrEqual(4);
          expect(new Set(subset.map((q) => q.direction)).size).toBe(2);
        }
        for (const direction of [1, -1]) {
          expect(items.filter((q) => q.direction === direction).length).toBeGreaterThanOrEqual(6);
        }
      }
      // 同じ性向の回答は設問の正逆・抽出の違いで変わらない。
      const positive = createEmptyMbtiScores();
      const negative = createEmptyMbtiScores();
      for (const q of questions) {
        positive[q.axis] += scoreMbtiAnswer(q, q.direction === 1 ? 'agree' : 'disagree');
        negative[q.axis] += scoreMbtiAnswer(q, q.direction === 1 ? 'disagree' : 'agree');
      }
      for (const axis of MBTI_AXES) {
        expect(computeMbtiAxisPercent(positive, axis)).toBe(100);
        expect(computeMbtiAxisPercent(negative, axis)).toBe(0);
      }
    }
    expect(sets.size).toBe(200);
    expect(JSON.stringify(MBTI_QUESTION_POOL)).toBe(original);
  });

  it('逆方向の採点と旧セッションの互換をすべての回答で維持する', () => {
    for (const answer of MBTI_LIKERT_ANSWERS) {
      expect(scoreMbtiAnswer({ direction: -1 }, answer)).toBe(-mbtiLikertWeight(answer));
      expect(scoreMbtiAnswer({ direction: 1 }, answer)).toBe(mbtiLikertWeight(answer));
      expect(scoreMbtiAnswer({}, answer)).toBe(mbtiLikertWeight(answer));
    }
  });

  it('設問文の重複がなく、各観点に正逆13問ずつある', () => {
    expect(new Set(MBTI_QUESTION_POOL.map((q) => q.prompt)).size).toBe(MBTI_QUESTION_POOL.length);
    for (const axis of MBTI_AXES) {
      const current = MBTI_QUESTION_POOL.filter((q) => q.axis === axis && q.facet);
      for (const facet of new Set(current.map((q) => q.facet))) {
        for (const direction of [1, -1]) {
          expect(
            current.filter((q) => q.facet === facet && q.direction === direction),
          ).toHaveLength(13);
        }
      }
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

  it('computeMbtiIdentityはAT軸のscoreからA/Tを判定し、タイプ(computeMbtiType)とは独立している', () => {
    const scores = createEmptyMbtiScores();
    scores.AT = MBTI_AXIS_QUESTION_COUNTS.AT * 2;
    expect(computeMbtiIdentity(scores)).toBe('A');
    // 4文字タイプの計算にATが影響しないことも確認する(Role付与は4文字タイプのみを使うため)。
    expect(computeMbtiType(scores)).toBe('ESTJ');

    scores.AT = -MBTI_AXIS_QUESTION_COUNTS.AT * 2;
    expect(computeMbtiIdentity(scores)).toBe('T');
    expect(computeMbtiType(scores)).toBe('ESTJ');
  });

  it('AT score 0(タイ)は正方向側(A)として扱う', () => {
    expect(computeMbtiIdentity(createEmptyMbtiScores())).toBe('A');
  });

  it('A/Tそれぞれにlabelとdescriptionが定義されている', () => {
    expect(MBTI_IDENTITY_INFO.A.label).toBeTruthy();
    expect(MBTI_IDENTITY_INFO.A.description).toBeTruthy();
    expect(MBTI_IDENTITY_INFO.T.label).toBeTruthy();
    expect(MBTI_IDENTITY_INFO.T.description).toBeTruthy();
  });
});

describe('question ordering', () => {
  it('avoids adjacent questions on the same axis across deterministic seeds', () => {
    for (let seed = 1; seed <= 100; seed++) {
      let state = seed;
      const questions = selectMbtiQuestions(() => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      });
      expect(questions).toHaveLength(62);
      expect(questions.slice(1).every((q, i) => q.axis !== questions[i]!.axis)).toBe(true);
    }
  });
});
