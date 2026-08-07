import { DiscordApiError } from './discord.ts';

export function discordApiErrorResponse(error: DiscordApiError): Response {
  if (error.status === 401) {
    return Response.json({ error: 'Discord の再ログインが必要です' }, { status: 401 });
  }

  if (error.status === 403) {
    return Response.json({ error: 'Discord API へのアクセスが拒否されました' }, { status: 403 });
  }

  if (error.status === 429) {
    const retryAfterSeconds =
      error.retryAfterMs === null ? null : Math.max(1, Math.ceil(error.retryAfterMs / 1_000));
    return Response.json(
      {
        error: 'Discord API のレート制限中です。少し待ってから再試行してください',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers:
          retryAfterSeconds === null ? undefined : { 'Retry-After': String(retryAfterSeconds) },
      },
    );
  }

  if (error.status >= 500) {
    return Response.json(
      { error: 'Discord API が一時的に利用できません。しばらく待ってから再試行してください' },
      { status: 503 },
    );
  }

  return Response.json({ error: 'Discord API への接続に失敗しました' }, { status: 502 });
}
