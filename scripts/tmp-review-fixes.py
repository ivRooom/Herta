from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found: {path}\n{old[:180]}")
    file.write_text(text.replace(old, new, 1))


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


# Presence subscriber: failed startup must be retryable and same-ms updates must not be dropped.
replace_once(
    "apps/bot/src/presence/runtime-events.ts",
    """    await redis.connect();
    await redis.subscribe(BOT_PRESENCE_EVENT_CHANNEL);
    await this.refreshStoredPresence();
""",
    """    try {
      await redis.connect();
      await redis.subscribe(BOT_PRESENCE_EVENT_CHANNEL);
      await this.refreshStoredPresence();
    } catch (error) {
      this.redis = undefined;
      redis.disconnect();
      throw error;
    }
""",
)
replace_once(
    "apps/bot/src/presence/runtime-events.ts",
    "    if (occurredAt <= this.lastOccurredAt) return;\n",
    "    if (occurredAt < this.lastOccurredAt) return;\n",
)
replace_once(
    "apps/bot/src/presence/runtime-events.test.ts",
    "  it('不正イベントと古いイベントを適用しない', () => {\n",
    """  it('同一timestampの更新も適用する', () => {
    const onPresenceChanged = vi.fn();
    const subscriber = new BotPresenceEventSubscriber(onPresenceChanged, createLogger());
    const occurredAt = '2026-08-15T13:00:00.000Z';

    subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt,
        config: { status: 'online', activityType: 'playing', activityText: 'First' },
      }),
    );
    subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt,
        config: { status: 'idle', activityType: 'watching', activityText: 'Second' },
      }),
    );

    expect(onPresenceChanged).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenLastCalledWith({
      status: 'idle',
      activityType: 'watching',
      activityText: 'Second',
    });
  });

  it('不正イベントと古いイベントを適用しない', () => {
""",
)

# Shared bounded body reader protects chunked and misleading Content-Length requests.
write(
    "apps/studio/src/lib/bounded-request-body.ts",
    """export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured limit');
    this.name = 'RequestBodyTooLargeError';
  }
}

export async function readRequestBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const bytes = await readRequestBodyBytes(request, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
""",
)
replace_once(
    "apps/studio/src/lib/request-origin.test.ts",
    "import { isSameOriginMutationRequest } from './request-origin.ts';\n",
    """import {
  RequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from './bounded-request-body.ts';
import { isSameOriginMutationRequest } from './request-origin.ts';
""",
)
with Path("apps/studio/src/lib/request-origin.test.ts").open("a") as file:
    file.write(
        """

test('実際のbodyサイズをContent-Lengthに依存せず制限する', async () => {
  const withoutLength = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(128) }),
  });
  assert.equal(withoutLength.headers.get('content-length'), null);
  await assert.rejects(() => readJsonBodyWithLimit(withoutLength, 64), RequestBodyTooLargeError);

  const misleadingLength = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
    body: JSON.stringify({ value: 'x'.repeat(128) }),
  });
  await assert.rejects(() => readJsonBodyWithLimit(misleadingLength, 64), RequestBodyTooLargeError);
});

test('上限内のJSON bodyを解析する', async () => {
  const request = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultGuildId: '123456789012345678' }),
  });
  assert.deepEqual(await readJsonBodyWithLimit(request, 256), {
    defaultGuildId: '123456789012345678',
  });
});
"""
    )

# Presence API: actual-byte body limit and subscriber notification semantics (not an ACK).
replace_once(
    "apps/studio/src/app/api/bot/presence/route.ts",
    "import { getStoredBotPresence, saveBotPresence } from '@/lib/bot-presence-store';\n",
    """import {
  RequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from '@/lib/bounded-request-body';
import { getStoredBotPresence, saveBotPresence } from '@/lib/bot-presence-store';
""",
)
replace_once(
    "apps/studio/src/app/api/bot/presence/route.ts",
    """  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
""",
    """  let body: unknown;
  try {
    body = await readJsonBodyWithLimit(request, 4_096);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
""",
)
replace_once(
    "apps/studio/src/app/api/bot/presence/route.ts",
    "      appliedImmediately: result.subscriberCount > 0,\n",
    "      notificationDelivered: result.subscriberCount > 0,\n",
)
text = Path("apps/studio/src/app/api/bot/presence/route.ts").read_text()
text = text.replace("      actorId: session.user.id,\n", "")
Path("apps/studio/src/app/api/bot/presence/route.ts").write_text(text)

# Default server API uses the same bounded reader and avoids direct user IDs in logs.
replace_once(
    "apps/studio/src/app/api/me/studio-preferences/route.ts",
    "import { auth } from '@/auth';\n",
    """import { auth } from '@/auth';
import {
  RequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from '@/lib/bounded-request-body';
""",
)
replace_once(
    "apps/studio/src/app/api/me/studio-preferences/route.ts",
    """  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 1_024) {
    return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
""",
    """  let body: unknown;
  try {
    body = await readJsonBodyWithLimit(request, 1_024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'リクエストサイズが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
""",
)
text = Path("apps/studio/src/app/api/me/studio-preferences/route.ts").read_text()
text = text.replace("      userId: session.user.id,\n", "")
Path("apps/studio/src/app/api/me/studio-preferences/route.ts").write_text(text)

# Bot profile API bounds multipart reads and records the true nickname delta.
replace_once(
    "apps/studio/src/app/api/guilds/[guildId]/bot-profile/route.ts",
    "import { auth } from '@/auth';\n",
    """import { auth } from '@/auth';
import {
  RequestBodyTooLargeError,
  readRequestBodyBytes,
} from '@/lib/bounded-request-body';
""",
)
replace_once(
    "apps/studio/src/app/api/guilds/[guildId]/bot-profile/route.ts",
    """  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BODY_BYTES) {
    return NextResponse.json({ error: 'アップロードサイズが大きすぎます' }, { status: 413 });
  }

""",
    "",
)
replace_once(
    "apps/studio/src/app/api/guilds/[guildId]/bot-profile/route.ts",
    """  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'フォームデータが不正です' }, { status: 400 });
  }
""",
    """  let formData: FormData;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      return NextResponse.json({ error: 'フォームデータが不正です' }, { status: 400 });
    }
    const body = await readRequestBodyBytes(request, MAX_FORM_BODY_BYTES);
    formData = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'アップロードサイズが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'フォームデータが不正です' }, { status: 400 });
  }
""",
)
replace_once(
    "apps/studio/src/app/api/guilds/[guildId]/bot-profile/route.ts",
    """  try {
    const profile = await updateDiscordBotGuildProfile(guildId, { nickname, avatar });
""",
    """  try {
    const previousProfile = await getDiscordBotGuildProfile(guildId);
    const profile = await updateDiscordBotGuildProfile(guildId, { nickname, avatar });
""",
)
replace_once(
    "apps/studio/src/app/api/guilds/[guildId]/bot-profile/route.ts",
    "            nicknameChanged: true,\n",
    "            nicknameChanged: previousProfile.nickname !== profile.nickname,\n",
)

# Avoid direct user IDs in layout request-path logs.
text = Path("apps/studio/src/app/dashboard/layout.tsx").read_text()
text = text.replace("      userId: session.user.id,\n", "").replace(
    "        userId: session.user.id,\n", ""
)
Path("apps/studio/src/app/dashboard/layout.tsx").write_text(text)

# Reset native avatar input as well as React state; use precise notification wording.
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    "import { useEffect, useState, type FormEvent } from 'react';\n",
    "import { useEffect, useRef, useState, type FormEvent } from 'react';\n",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
""",
    """  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function clearAvatarInput() {
    setAvatarFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  useEffect(() => {
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """      setProfile(body.profile);
      setNickname(body.profile.nickname ?? '');
      setAvatarFile(null);
      setAvatarReset(false);
""",
    """      setProfile(body.profile);
      setNickname(body.profile.nickname ?? '');
      clearAvatarInput();
      setAvatarReset(false);
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """    if (!file) {
      setAvatarFile(null);
      return;
    }
""",
    """    if (!file) {
      clearAvatarInput();
      return;
    }
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """      setError('AvatarはPNG / JPEG / GIFを選択してください');
      return;
""",
    """      setError('AvatarはPNG / JPEG / GIFを選択してください');
      clearAvatarInput();
      return;
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """      setError('Avatarは1MiB以下にしてください');
      return;
""",
    """      setError('Avatarは1MiB以下にしてください');
      clearAvatarInput();
      return;
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """              <input
                id="bot-avatar"
                type="file"
""",
    """              <input
                id="bot-avatar"
                ref={avatarInputRef}
                type="file"
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """              onClick={() => {
                setAvatarFile(null);
                setAvatarReset(true);
              }}
""",
    """              onClick={() => {
                clearAvatarInput();
                setAvatarReset(true);
              }}
""",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    "        appliedImmediately?: boolean;\n",
    "        notificationDelivered?: boolean;\n",
)
replace_once(
    "apps/studio/src/components/bot-profile-settings.tsx",
    """        body.appliedImmediately
          ? 'Presenceを保存し、起動中のBotへ反映しました'
""",
    """        body.notificationDelivered
          ? 'Presenceを保存し、起動中のBotへ反映通知を送信しました'
""",
)

replace_once(
    "apps/studio/src/components/console-command-palette.tsx",
    '<span className="ml-auto">サーバー固有機能はGuild画面で表示</span>',
    '<span className="ml-auto">Server Switcherでサーバーを選択すると固有機能を表示</span>',
)

# Server switcher accessibility: persistent live region, proper list semantics and labelled icons.
replace_once(
    "apps/studio/src/components/guild-context-nav.tsx",
    """              aria-label="デフォルト"
            />
""",
    """              aria-label="デフォルト"
              role="img"
            />
""",
)
replace_once(
    "apps/studio/src/components/guild-context-nav.tsx",
    '<Check className="h-4 w-4 shrink-0 text-primary" aria-label="選択中" />',
    '<Check className="h-4 w-4 shrink-0 text-primary" aria-label="選択中" role="img" />',
)
replace_once(
    "apps/studio/src/components/guild-context-nav.tsx",
    """                  {preferenceMessage ? (
                    <p className="mt-2 text-center text-[10px] text-muted" role="status">
                      {preferenceMessage}
                    </p>
                  ) : null}
""",
    """                  <p
                    className="mt-2 text-center text-[10px] text-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {preferenceMessage ?? ''}
                  </p>
""",
)
replace_once(
    "apps/studio/src/components/guild-context-nav.tsx",
    """      {candidates.map((guild) => (
        <button
          key={guild.id}
          type="button"
          role="listitem"
          onClick={() => onSelect(guild)}
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
            <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={30} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block truncate font-medium">{guild.name}</span>
              {defaultGuildId === guild.id ? (
                <Star
                  className="h-3 w-3 shrink-0 fill-current text-amber-400"
                  aria-label="デフォルト"
                />
              ) : null}
            </span>
            <span className="block truncate text-[10px] text-muted">{guild.id}</span>
          </span>
        </button>
      ))}
""",
    """      {candidates.map((guild) => (
        <div key={guild.id} role="listitem">
          <button
            type="button"
            onClick={() => onSelect(guild)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
              <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={30} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block truncate font-medium">{guild.name}</span>
                {defaultGuildId === guild.id ? (
                  <Star
                    className="h-3 w-3 shrink-0 fill-current text-amber-400"
                    aria-label="デフォルト"
                    role="img"
                  />
                ) : null}
              </span>
              <span className="block truncate text-[10px] text-muted">{guild.id}</span>
            </span>
          </button>
        </div>
      ))}
""",
)

# Do not rebroadcast a stale server-rendered default into another tab.
replace_once(
    "apps/studio/src/components/studio-server-context.tsx",
    """    try {
      sessionGuildId = window.sessionStorage.getItem(STUDIO_SELECTED_SERVER_SESSION_KEY);
      window.localStorage.setItem(
        STUDIO_SERVER_PREFERENCES_STORAGE_KEY,
        serializeStudioServerPreferences({
          version: 1,
          defaultGuildId:
            initialDefaultGuildId && guildById.has(initialDefaultGuildId)
              ? initialDefaultGuildId
              : null,
        }),
      );
    } catch {
""",
    """    try {
      sessionGuildId = window.sessionStorage.getItem(STUDIO_SELECTED_SERVER_SESSION_KEY);
      // DB由来の初期値はstateだけへ反映し、古いタブからlocalStorageへ再配信しない。
    } catch {
""",
)

# Fail Redis commands immediately on a premature connection close.
replace_once(
    "apps/studio/src/lib/redis-command.ts",
    """    socket.once('error', fail);
  });
""",
    """    socket.once('error', fail);
    socket.once('close', () => {
      fail(new Error('Redis接続が応答前に切断されました'));
    });
  });
""",
)

# Moderation main entry remains highlighted on detail routes.
replace_once(
    "apps/studio/src/lib/studio-selected-server-navigation.ts",
    """    icon: 'moderation',
    exact: true,
  },
""",
    """    icon: 'moderation',
  },
""",
)
