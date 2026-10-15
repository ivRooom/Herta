import { describe, expect, it } from 'vitest';
import { MBTI_AXES, MBTI_AXIS_QUESTION_COUNTS, createEmptyMbtiScores } from './mbti-core.js';
import { createMbtiReport, mbtiShareSearch, parseMbtiShareScores } from './mbti-report.js';

describe('MBTI report and public snapshots', () => {
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
