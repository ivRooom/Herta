import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  dailyRescueActionRow,
  dailyRescueEmbed,
  rescueDelivery,
} from './daily-participation-rescue.js';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
it('rescue announcement shows the question, options, deadline and how to answer', () => {
  const parsed = rescueDelivery.parse(fixture.rescueDelivery),
    embed = dailyRescueEmbed(parsed).toJSON();
  expect(embed.title).toBe('🆘 追加問題のお知らせ');
  expect(embed.footer?.text).toBe(`daily-rescue:${fixture.rescueDelivery.questionId}`);
  expect(embed.description).toContain('問題：Synthetic rescue question');
  expect(embed.description).toContain('・A');
  expect(embed.description).toContain('・B');
  const closesAtUnix = Math.floor(Date.parse(fixture.rescueDelivery.question.closesAt) / 1000);
  expect(embed.description).toContain(`締切：<t:${closesAtUnix}:F> まで`);
  expect(embed.description).toContain('今日の問題に挑戦');
  expect(embed.description).toContain('Member ページからできます');
  expect(JSON.stringify(embed)).not.toContain('discordUserId');
});
it('rescue action row is a plain link button to the member participation page', () => {
  const row = dailyRescueActionRow().toJSON();
  expect(row.components).toHaveLength(1);
  expect(row.components[0]).toMatchObject({
    url: 'https://member.ivrm.jp/participation',
    label: 'Member ページで回答する',
  });
  expect(row.components[0]).not.toHaveProperty('custom_id');
});
it('rescue delivery accepts the full public question shape and enforces its refinements', () => {
  const parsed = rescueDelivery.parse(fixture.rescueDelivery);
  expect(parsed.question.id).toBe(fixture.rescueDelivery.questionId);
  expect(parsed.question.slot).toBe('rescue');
  expect(parsed.question.media).toEqual([]);
  expect(parsed.question.options.every((o) => o.mediaId === null)).toBe(true);
  expect(
    rescueDelivery.safeParse({
      ...fixture.rescueDelivery,
      question: {
        ...fixture.rescueDelivery.question,
        options: fixture.rescueDelivery.question.options.map((o: { id: string }, i: number) =>
          i === 0 ? { ...o, mediaId: 'missing_media' } : o,
        ),
      },
    }).success,
  ).toBe(false);
  expect(
    rescueDelivery.safeParse({
      ...fixture.rescueDelivery,
      question: { ...fixture.rescueDelivery.question, format: 'choice4' },
    }).success,
  ).toBe(false);
});
it('rescue delivery schema rejects identities, unknown states and malformed deadlines', () => {
  expect(
    rescueDelivery.safeParse({ ...fixture.rescueDelivery, discordUserId: 'synthetic' }).success,
  ).toBe(false);
  expect(rescueDelivery.safeParse({ ...fixture.rescueDelivery, status: 'sent' }).success).toBe(
    false,
  );
  expect(
    rescueDelivery.safeParse({
      ...fixture.rescueDelivery,
      question: { ...fixture.rescueDelivery.question, closesAt: 'not-a-date' },
    }).success,
  ).toBe(false);
});
