export type StudioApiFeedbackContext = 'access-control' | 'role-lifecycle' | 'generic';

interface ApiErrorBody {
  error?: string;
  details?: string[];
}

export function describeStudioApiError(
  status: number,
  body: ApiErrorBody | null,
  fallback: string,
  context: StudioApiFeedbackContext = 'generic',
): string {
  const serverMessage = [body?.error, ...(body?.details ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' / ');

  if (status === 401) {
    return [
      'ログイン状態を確認してください',
      'セッションの有効期限が切れている可能性があります。ページを再読み込みし、必要であればDiscordで再ログインしてから再試行してください。',
    ].join('\n');
  }

  if (status === 403 && serverMessage.includes('不正なリクエスト元')) {
    return [
      'セキュリティ保護により操作を拒否しました',
      'ページを再読み込みし、Herta Studioを開いている同じタブ・ドメインからもう一度操作してください。改善しない場合は再ログインしてください。',
    ].join('\n');
  }

  if (status === 403) {
    if (context === 'access-control') {
      return [
        'この操作を実行する権限がありません',
        '必要な権限: OWNER root Role',
        'サーバー所有者またはOWNER root管理者にRoleの付与を依頼してください。すでにDiscord側で付与済みの場合は、ページを再読み込みして権限情報を更新してから再試行してください。',
      ].join('\n');
    }
    if (context === 'role-lifecycle') {
      return [
        'Discord Roleを変更する権限がありません',
        '必要な権限: OWNER root Role',
        'サーバー所有者またはOWNER root管理者にRoleの付与を依頼してください。付与済みの場合はページを再読み込みしてから再試行してください。',
      ].join('\n');
    }
    return [
      'この操作を実行する権限がありません',
      serverMessage || '必要な権限を持つ管理者へ権限付与を依頼してください。',
    ].join('\n');
  }

  if (status === 409 && serverMessage.includes('Herta Botに「ロールの管理」権限がありません')) {
    return [
      'Herta BotのDiscord権限が不足しています',
      '必要な権限: ロールの管理',
      'Discordのサーバー設定 → ロールでHerta Botに「ロールの管理」を付与し、Herta BotのRoleを操作対象Roleより上に配置してください。',
    ].join('\n');
  }

  if (status === 409 && serverMessage.includes('上位または同順位のRole')) {
    return [
      'DiscordのRole階層により操作できません',
      'Herta BotのRoleを操作対象Roleより上に移動してから再試行してください。',
    ].join('\n');
  }

  return serverMessage || fallback;
}
