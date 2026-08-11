import { describe, expect, it } from 'vitest';
import {
  coreUtilityV3Commands,
  discordSnowflakeCreatedAt,
  formatDiscordTimestamp,
  parseTeamMembers,
  splitIntoTeams,
} from './utility-v3.js';

describe('Core Utility v3', () => {
  it('5つのCommandを重複なく登録する', () => {
    const names = coreUtilityV3Commands.map((command) => command.definition.name);
    expect(names).toEqual(['utilities', 'teams', 'uuid', 'timestamp', 'snowflake']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('チーム分け入力をカンマ・読点・改行で分割する', () => {
    expect(parseTeamMembers('A, B、C\nD')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('チーム分けでメンバーを失わず人数差を1以内にする', () => {
    const source = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const teams = splitIntoTeams(source, 3);
    expect(teams.flat().sort()).toEqual([...source].sort());
    const sizes = teams.map((team) => team.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('Discord Snowflakeから作成日時を復元する', () => {
    const date = discordSnowflakeCreatedAt('175928847299117063');
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe('2016-04-30T11:18:25.796Z');
    expect(discordSnowflakeCreatedAt('abc')).toBeNull();
    expect(discordSnowflakeCreatedAt('0')).toBeNull();
  });

  it('Discord timestamp記法を生成する', () => {
    expect(formatDiscordTimestamp(1_700_000_000, 'F')).toBe('<t:1700000000:F>');
    expect(formatDiscordTimestamp(1_700_000_000.9, 'R')).toBe('<t:1700000000:R>');
  });

  it('必須OptionとDiscord入力境界を定義する', () => {
    const teams = coreUtilityV3Commands.find((command) => command.definition.name === 'teams');
    const timestamp = coreUtilityV3Commands.find(
      (command) => command.definition.name === 'timestamp',
    );
    const snowflake = coreUtilityV3Commands.find(
      (command) => command.definition.name === 'snowflake',
    );

    expect(teams?.definition.options?.[0]).toMatchObject({
      name: 'members',
      type: 'string',
      required: true,
    });
    expect(teams?.definition.options?.[1]).toMatchObject({
      name: 'teams',
      type: 'integer',
      required: true,
      minValue: 2,
      maxValue: 10,
    });
    expect(timestamp?.definition.options?.[0]).toMatchObject({
      name: 'unix',
      type: 'integer',
      required: true,
    });
    expect(snowflake?.definition.options?.[0]).toMatchObject({
      name: 'id',
      type: 'string',
      required: true,
    });
  });
});
