import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { correctionDelivery, dailyCorrectionEmbed } from './daily-participation-corrections.js';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
function deliveryWith(correction: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return correctionDelivery.parse({
    ...fixture.correctionDelivery,
    ...extra,
    correction: { ...fixture.correctionDelivery.correction, ...correction },
  });
}
it('correction notification shows the change, reason, corrected proportions and grants', () => {
  const parsed = correctionDelivery.parse(fixture.correctionDelivery),
    embed = dailyCorrectionEmbed(parsed).toJSON();
  expect(embed.title).toBe('📊 結果の訂正のお知らせ');
  expect(embed.footer?.text).toBe(`daily-correction:${fixture.correctionDelivery.correctionId}`);
  expect(embed.description).toContain('2026-10-31 の問題について、結果を訂正しました。');
  expect(embed.description).toContain('問題：Synthetic poll');
  expect(embed.description).toContain('正解を『B』に訂正しました');
  expect(embed.description).toContain('理由：Synthetic correction reason');
  expect(embed.description).toContain('訂正後の結果：');
  expect(embed.description).toContain('70.0%');
  expect(embed.description).toContain('参加者：10人');
  expect(embed.description).toContain('新たに正解となった方：7人（追加付与：合計 70pt）');
  expect(JSON.stringify(embed)).not.toContain('discordUserId');
});
it('correction embed phrases each kind and omits the grant line when nothing was granted', () => {
  const credit = dailyCorrectionEmbed(
    deliveryWith({ kind: 'credit_all' }, { correctedResult: undefined }),
  ).toJSON();
  expect(credit.description).toContain('全員正解として扱います');
  expect(credit.description).not.toContain('訂正後の結果：');
  const voided = dailyCorrectionEmbed(deliveryWith({ kind: 'void_all' })).toJSON();
  expect(voided.description).toContain('この問題は無効化されました');
  const explained = dailyCorrectionEmbed(
    deliveryWith({
      kind: 'explanation_only',
      explanation: 'Synthetic corrected explanation',
    }),
  ).toJSON();
  expect(explained.description).toContain('解説を訂正しました');
  expect(explained.description).toContain('Synthetic corrected explanation');
  const accepted = dailyCorrectionEmbed(
    deliveryWith({ kind: 'correct_answer', acceptedAnswers: ['A'] }),
  ).toJSON();
  expect(accepted.description).toContain('次の回答も正解として扱います：A');
  const noGrant = dailyCorrectionEmbed(
    deliveryWith({
      kind: 'credit_all',
      summary: { respondents: 10, newlyCorrect: 0, newlyIncorrect: 0, grantTotal: 0 },
    }),
  ).toJSON();
  expect(noGrant.description).not.toContain('新たに正解となった方');
});
it('correction delivery accepts the full API result shape for correctedResult', () => {
  const parsed = correctionDelivery.parse(fixture.correctionDelivery);
  expect(parsed.correctedResult?.questionId).toBe(fixture.correctionDelivery.questionId);
  expect(parsed.correctedResult?.dateJst).toBe('2026-10-31');
  expect(parsed.correctedResult?.finalizedAt).toBe('2026-11-01T00:05:00.000Z');
  expect(parsed.correctedResult?.options.map((o) => o.optionId)).toEqual(['a', 'b']);
  expect(
    correctionDelivery.safeParse({
      ...fixture.correctionDelivery,
      correctedResult: {
        ...fixture.correctionDelivery.correctedResult,
        options: fixture.correctionDelivery.correctedResult.options.map(
          (o: { votes: number }, i: number) => (i === 0 ? { ...o, votes: o.votes + 1 } : o),
        ),
      },
    }).success,
  ).toBe(false);
});
it('correction delivery schema rejects identities, unknown kinds and malformed tokens', () => {
  expect(
    correctionDelivery.safeParse({ ...fixture.correctionDelivery, discordUserId: 'synthetic' })
      .success,
  ).toBe(false);
  expect(
    correctionDelivery.safeParse({
      ...fixture.correctionDelivery,
      correction: { ...fixture.correctionDelivery.correction, kind: 'unknown' },
    }).success,
  ).toBe(false);
  expect(
    correctionDelivery.safeParse({ ...fixture.correctionDelivery, deliveryToken: 'short' }).success,
  ).toBe(false);
});
