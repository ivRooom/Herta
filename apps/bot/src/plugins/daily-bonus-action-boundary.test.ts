import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const v1 = readFileSync(new URL('./daily-bonus.ts', import.meta.url), 'utf8');
const v2 = readFileSync(new URL('./daily-participation.ts', import.meta.url), 'utf8');

describe('daily action side effects (source contract)', () => {
  it('V1 fortune is only displayed after explicitly selecting the fortune button', () => {
    expect(v1).toContain("if (auxiliary?.[1] === 'fortune')");
    expect(v1).toContain('await displayDailyFortune(ctx, interaction, date);');
    expect(v1).not.toContain("displayDailyFortune(ctx, interaction, date, 'followUp')");
    expect(v1).not.toContain("mode: 'edit' | 'followUp'");
  });

  it('V2 login-only claim does not implicitly fetch questions or show fortune', () => {
    expect(v2).not.toContain('participationFortune(');
    const claim = v2.indexOf('if (wantsClaim) {');
    const questions = v2.indexOf('const state: ParticipationStatus =');
    expect(claim).toBeGreaterThan(0);
    expect(questions).toBeGreaterThan(claim);
    expect(v2.slice(claim, questions)).toContain('await replyDailyBonusResult(');
    expect(v2.slice(claim, questions)).toMatch(
      /await replyDailyBonusResult\([\s\S]*?\);\s*return;\s*}/,
    );
  });
});
