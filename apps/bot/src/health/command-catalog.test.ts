import { describe, expect, it, vi } from 'vitest';
import {
  GuildCommandCatalogError,
  fetchGuildCommandCatalog,
  isCoreCommandName,
} from './command-catalog.js';

const APPLICATION_ID = '111111111111111111';
const GUILD_ID = '222222222222222222';

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Guild command catalog', () => {
  it('Discord登録済みCommandをCoreとPluginへ分類する', async () => {
    const fetchImpl = vi.fn(async () =>
      response([
        {
          id: '333333333333333333',
          name: 'color',
          description: 'color command',
          options: [
            {
              name: 'value',
              description: 'color value',
              type: 3,
              required: true,
            },
          ],
        },
        {
          id: '444444444444444444',
          name: 'amidakuji',
          description: 'amidakuji command',
          options: [],
        },
      ]),
    ) as unknown as typeof fetch;

    const catalog = await fetchGuildCommandCatalog('bot-token', APPLICATION_ID, GUILD_ID, fetchImpl);

    expect(catalog.guildId).toBe(GUILD_ID);
    expect(catalog.commands).toEqual([
      expect.objectContaining({ name: 'amidakuji', source: 'plugin' }),
      expect.objectContaining({ name: 'color', source: 'core' }),
    ]);
    expect(catalog.commands[1]?.options[0]).toMatchObject({
      name: 'value',
      type: 'string',
      required: true,
    });
  });

  it('subcommand・choice・min/maxを解析する', async () => {
    const fetchImpl = vi.fn(async () =>
      response([
        {
          id: '333333333333333333',
          name: 'sample',
          description: 'sample',
          options: [
            {
              name: 'run',
              description: 'run sample',
              type: 1,
              options: [
                {
                  name: 'count',
                  description: 'count',
                  type: 4,
                  min_value: 1,
                  max_value: 10,
                  choices: [
                    { name: 'one', value: 1 },
                    { name: 'two', value: 2 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ) as unknown as typeof fetch;

    const catalog = await fetchGuildCommandCatalog('bot-token', APPLICATION_ID, GUILD_ID, fetchImpl);
    const count = catalog.commands[0]?.options[0]?.options?.[0];

    expect(count).toMatchObject({ type: 'integer', minValue: 1, maxValue: 10 });
    expect(count?.choices).toEqual([
      { name: 'one', value: 1 },
      { name: 'two', value: 2 },
    ]);
  });

  it('Plugin所有のcoinflipとdiceをCore扱いしない', () => {
    expect(isCoreCommandName('color')).toBe(true);
    expect(isCoreCommandName('hash')).toBe(true);
    expect(isCoreCommandName('coinflip')).toBe(false);
    expect(isCoreCommandName('dice')).toBe(false);
  });

  it('Discord rate limitを429として保持する', async () => {
    const fetchImpl = vi.fn(async () => response({}, 429)) as unknown as typeof fetch;

    await expect(
      fetchGuildCommandCatalog('bot-token', APPLICATION_ID, GUILD_ID, fetchImpl),
    ).rejects.toMatchObject({ name: 'GuildCommandCatalogError', status: 429 });
  });

  it('不正な設定と不正なDiscord応答を拒否する', async () => {
    await expect(fetchGuildCommandCatalog('', APPLICATION_ID, GUILD_ID)).rejects.toBeInstanceOf(
      GuildCommandCatalogError,
    );

    const fetchImpl = vi.fn(async () => response({ not: 'array' })) as unknown as typeof fetch;
    await expect(
      fetchGuildCommandCatalog('bot-token', APPLICATION_ID, GUILD_ID, fetchImpl),
    ).rejects.toMatchObject({ status: 502 });
  });
});
