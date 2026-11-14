import { describe, expect, it, vi } from 'vitest';
import {
  ReleaseNotificationSendError,
  parseReleaseNotificationSendInput,
  sendReleaseNotification,
} from './release-notifications-send.js';

const CHANNEL_ID = '123456789012345678';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseReleaseNotificationSendInput', () => {
  it('最小入力を受け付ける', () => {
    expect(
      parseReleaseNotificationSendInput({ destinationChannelId: CHANNEL_ID, content: 'hello' }),
    ).toEqual({ channelId: CHANNEL_ID, content: 'hello', embeds: [] });
  });

  it('embeds を最大10件まで受け付け、それ以外を弾く', () => {
    const ok = parseReleaseNotificationSendInput({
      destinationChannelId: CHANNEL_ID,
      content: 'x',
      embeds: [{ title: 't' }],
    });
    expect(ok?.embeds).toHaveLength(1);
    expect(
      parseReleaseNotificationSendInput({
        destinationChannelId: CHANNEL_ID,
        content: 'x',
        embeds: Array.from({ length: 11 }, () => ({})),
      }),
    ).toBeNull();
    expect(
      parseReleaseNotificationSendInput({
        destinationChannelId: CHANNEL_ID,
        content: 'x',
        embeds: ['not-a-record'],
      }),
    ).toBeNull();
  });

  it('channelId の形式と content の長さを検証する', () => {
    expect(
      parseReleaseNotificationSendInput({ destinationChannelId: 'abc', content: 'x' }),
    ).toBeNull();
    expect(
      parseReleaseNotificationSendInput({ destinationChannelId: CHANNEL_ID, content: '' }),
    ).toBeNull();
    expect(
      parseReleaseNotificationSendInput({
        destinationChannelId: CHANNEL_ID,
        content: 'x'.repeat(2001),
      }),
    ).toBeNull();
    expect(parseReleaseNotificationSendInput(null)).toBeNull();
    expect(parseReleaseNotificationSendInput('raw')).toBeNull();
  });
});

describe('sendReleaseNotification', () => {
  it('メンションを空に固定して投稿し messageId を返す', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith(`/channels/${CHANNEL_ID}`)) {
        return jsonResponse({ id: CHANNEL_ID, type: 0, guild_id: '999999999999999999' });
      }
      return jsonResponse({ id: '555555555555555555' }, 201);
    }) as unknown as typeof fetch;

    const result = await sendReleaseNotification(
      'token',
      { channelId: CHANNEL_ID, content: 'release!', embeds: [{ title: 'v1' }] },
      fetchImpl,
    );
    expect(result).toEqual({ messageId: '555555555555555555', channelId: CHANNEL_ID });
    const post = calls.find((c) => c.url.endsWith('/messages'));
    const body = JSON.parse(String(post?.init?.body)) as Record<string, unknown>;
    expect(body.content).toBe('release!');
    expect(body.embeds).toEqual([{ title: 'v1' }]);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('チャンネルが見つからない場合は Discord の 404 をそのまま返す', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: 'Unknown Channel' }, 404),
    ) as unknown as typeof fetch;
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ name: 'ReleaseNotificationSendError', status: 404 });
  });

  it('DM チャンネルと投稿不可の種別を 400 で弾く', async () => {
    const dmFetch = vi.fn(async () =>
      jsonResponse({ id: CHANNEL_ID, type: 1 }),
    ) as unknown as typeof fetch;
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        dmFetch,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const categoryFetch = vi.fn(async () =>
      jsonResponse({ id: CHANNEL_ID, type: 4, guild_id: '999999999999999999' }),
    ) as unknown as typeof fetch;
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        categoryFetch,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('ロック中のスレッドは 409、投稿失敗は Discord の状態を保持する', async () => {
    const lockedFetch = vi.fn(async () =>
      jsonResponse({
        id: CHANNEL_ID,
        type: 11,
        guild_id: '999999999999999999',
        thread_metadata: { locked: true, archived: false },
      }),
    ) as unknown as typeof fetch;
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        lockedFetch,
      ),
    ).rejects.toMatchObject({ status: 409 });

    const failingFetch = vi.fn(async (url: string) => {
      if (url.endsWith(`/channels/${CHANNEL_ID}`)) {
        return jsonResponse({ id: CHANNEL_ID, type: 0, guild_id: '999999999999999999' });
      }
      return jsonResponse({ message: 'Missing Permissions' }, 403);
    }) as unknown as typeof fetch;
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        failingFetch,
      ),
    ).rejects.toBeInstanceOf(ReleaseNotificationSendError);
    await expect(
      sendReleaseNotification(
        'token',
        { channelId: CHANNEL_ID, content: 'x', embeds: [] },
        failingFetch,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
