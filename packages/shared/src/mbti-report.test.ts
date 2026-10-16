import { describe, expect, it } from 'vitest';
import { MBTI_AXES, MBTI_AXIS_QUESTION_COUNTS, createEmptyMbtiScores } from './mbti-core.js';
import { createMbtiReport, mbtiShareSearch, parseMbtiShareScores } from './mbti-report.js';

describe('MBTI report and public snapshots', () => {
  it('preserves the estimate label in shared URLs and rejects ambiguous basis flags', () => {
    const scores = { EI: 1, SN: -1, TF: -3, JP: 1, AT: -1 };
    const params = new URLSearchParams(mbtiShareSearch(scores, true));
    expect(params.get('basis')).toBe('estimate');
    expect(parseMbtiShareScores(params)).toEqual(scores);
    expect(createMbtiReport(scores).resultType).toBe('ENFJ');
    params.append('basis', 'estimate');
    expect(parseMbtiShareScores(params)).toBeNull();
    params.delete('basis');
    params.set('basis', 'measured');
    expect(parseMbtiShareScores(params)).toBeNull();
  });
  it('all 16 types and both identities have a full report', () => {
    for (let bits = 0; bits < 32; bits++) {
      const scores = createEmptyMbtiScores();
      MBTI_AXES.forEach((axis, index) => {
        scores[axis] = MBTI_AXIS_QUESTION_COUNTS[axis] * 2 * ((bits >> index) & 1 ? 1 : -1);
      });
      const report = createMbtiReport(scores);
      expect(report.axes).toHaveLength(5);
      expect(report.sections).toHaveLength(4);
      expect(report.title).toBeTruthy();
      expect(report.boundaryNote).toBeNull();
      for (const section of report.sections) {
        expect(section.items).toHaveLength(5);
        expect(section.items.every((item) => item.text.length > 15)).toBe(true);
      }
      expect(parseMbtiShareScores(new URLSearchParams(mbtiShareSearch(scores)))).toEqual(scores);
    }
  });
  it('near midpoint results do not receive one-sided advice', () => {
    const report = createMbtiReport(createEmptyMbtiScores());
    expect(report.boundaryNote).toBeTruthy();
    expect(report.axes.every((axis) => axis.balanced && axis.percent === 50)).toBe(true);
    expect(report.sections[1]!.items.every((item) => item.text.includes('境界'))).toBe(true);
  });
  it('rejects unknown versions, missing/duplicate scores, invalid values and private fields', () => {
    const valid = mbtiShareSearch(createEmptyMbtiScores());
    for (const query of [
      '',
      valid.replace('v=1', 'v=2'),
      valid + '&ei=1',
      valid.replace('ei=0', 'ei=27'),
      valid.replace('sn=0', 'sn=NaN'),
      valid.replace('tf=0', 'tf=0.1'),
      valid.replace('jp=0', 'jp=-25'),
      valid.replace('at=0', 'at=Infinity'),
      valid + '&sessionId=private',
    ]) {
      expect(parseMbtiShareScores(new URLSearchParams(query))).toBeNull();
    }
    expect([...new URLSearchParams(valid).keys()]).toEqual(['v', 'ei', 'sn', 'tf', 'jp', 'at']);
  });
});

describe('one-response sensitivity', () => {
  it('respects the zero-score positive tie rule and separates identity', () => {
    for (const score of [-5, -4, -1, 0, 3, 4, 5]) {
      const report = createMbtiReport({ EI: score, SN: 10, TF: 10, JP: 10, AT: score });
      const expected = score >= -4 && score < 4;
      expect(report.axes.find((axis) => axis.axis === 'EI')!.sensitive).toBe(expected);
      expect(report.axes.find((axis) => axis.axis === 'AT')!.sensitive).toBe(expected);
      expect(report.nearbyTypes.map((type) => type.type)).toEqual(
        expected ? [score < 0 ? 'ESTJ' : 'ISTJ'] : [],
      );
    }
  });
});
