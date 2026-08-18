import { describe, expect, it, vi } from 'vitest';
import {
  fetchGuildArchivedForumThreads,
  GuildForumThreadCatalogError,
} from './forum-thread-catalog.js';

const guildId = '123456789012345678';
const forumId = '223456789012345678';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchGuildArchivedForumThreads', () => {
  it('Forumを再検証し、同一Guild/Forumのpublic Threadだけ返す', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ id: forumId, guild_id: guildId, type: 15, position: 4 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          has_more: true,
          threads: [
            {
              id: '323456789012345678',
              guild_id: guildId,
              parent_id: forumId,
              type: 11,
              name: '過去のお知らせ',
              thread_metadata: { archive_timestamp: '2026-08-17T12:00:00.000Z' },
            },
            {
              id: '423456789012345678',
              guild_id: guildId,
              parent_id: '999456789012345678',
              type: 11,
              name: '別Forum',
              thread_metadata: { archive_timestamp: '2026-08-16T12:00:00.000Z' },
            },
          ],
        }),
      );

    const page = await fetchGuildArchivedForumThreads(
      'token',
      guildId,
      forumId,
      null,
      999,
      fetchImpl,
    );

    expect(page).toEqual({
      threads: [
        {
          id: '323456789012345678',
          name: '過去のお知らせ',
          kind: 'thread',
          position: 4,
          parentId: forumId,
          viewable: true,
          readMessageHistory: true,
        },
      ],
      nextBefore: '2026-08-17T12:00:00.000Z',
    });
    const archivedUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(archivedUrl.searchParams.get('limit')).toBe('50');
  });

  it('beforeをISOへ正規化してDiscordへ渡す', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: forumId, guild_id: guildId, type: 15 }))
      .mockResolvedValueOnce(jsonResponse({ has_more: false, threads: [] }));

    await fetchGuildArchivedForumThreads(
      'token',
      guildId,
      forumId,
      '2026-08-15T21:30:00+09:00',
      20,
      fetchImpl,
    );

    const archivedUrl = new URL(String(fetchImpl.mock.calls[1]?.[0]));
    expect(archivedUrl.searchParams.get('before')).toBe('2026-08-15T12:30:00.000Z');
  });

  it('別GuildのForumを拒否する', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: forumId,
        guild_id: '923456789012345678',
        type: 15,
      }),
    );

    await expect(
      fetchGuildArchivedForumThreads('token', guildId, forumId, null, 20, fetchImpl),
    ).rejects.toMatchObject<Partial<GuildForumThreadCatalogError>>({
      status: 403,
      code: 'guild_mismatch',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Forum以外と不正cursorを拒否する', async () => {
    const nonForumFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: forumId, guild_id: guildId, type: 0 }));
    await expect(
      fetchGuildArchivedForumThreads('token', guildId, forumId, null, 20, nonForumFetch),
    ).rejects.toMatchObject({ status: 400, code: 'not_forum' });

    await expect(
      fetchGuildArchivedForumThreads('token', guildId, forumId, 'not-a-date', 20, vi.fn()),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_before' });
  });

  it('Discordの403/429を安全なdomain errorへ変換する', async () => {
    const forbidden = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(
      fetchGuildArchivedForumThreads('token', guildId, forumId, null, 20, forbidden),
    ).rejects.toMatchObject({ status: 403, code: 'missing_permission' });

    const limited = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: forumId, guild_id: guildId, type: 15 }))
      .mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(
      fetchGuildArchivedForumThreads('token', guildId, forumId, null, 20, limited),
    ).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
