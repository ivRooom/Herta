import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('./daily-bonus.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function handleDailyBonus(');
const end = source.indexOf('async function displayDailyFortune(', start);
const handler = source.slice(start, end);

it('does not open a legacy quiz when receiving a login claim', () => {
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(handler).not.toContain('createDailyQuizSession');
  expect(handler).not.toContain('getDailyQuizSession');
  expect(handler).toContain(
    'claimDailyBonus(ctx.guildId, interaction.user.id, date, originalMessage)',
  );
});

it('has no legacy quiz button handling that could award login points', () => {
  // The V1 answer/questions stubs were removed with the V1 quiz retirement
  // (ivrm-web#770): old buttons fall through to the generic rejection and
  // never reach the claim call.
  expect(handler).not.toContain('daily-bonus:answer');
  expect(handler).not.toContain("'questions'");
  expect(handler).not.toContain('answer ? Number(answer[2])');
});

it('never appends fortune after a confirmed login claim', () => {
  const claimResult = handler.slice(handler.indexOf('await replyDailyBonusResult('));
  expect(claimResult).not.toContain('displayDailyFortune(');
  expect(claimResult).not.toContain('followUp(');
});
