import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { anonymousDailyResult, dailyResultEmbed } from './daily-participation-results.js';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
it('anonymous notification includes counts and proportions without response identities', () => {
  const parsed = anonymousDailyResult.parse(fixture.anonymousResult),
    embed = dailyResultEmbed(parsed).toJSON();
  expect(embed.description).toContain('参加者：10人');
  expect(embed.description).toContain('30.0%');
  expect(JSON.stringify(embed)).not.toContain('discordUserId');
  expect(
    anonymousDailyResult.safeParse({ ...fixture.anonymousResult, users: ['synthetic'] }).success,
  ).toBe(false);
  expect(
    anonymousDailyResult.safeParse({ ...fixture.anonymousResult, participantCount: 99 }).success,
  ).toBe(false);
});
