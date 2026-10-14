export const COMMUNITY_METRICS = [
  'messages',
  'voice_seconds',
  'reactions_given',
  'reactions_received',
  'minecraft_seconds',
  'online_seconds',
  'messages_edited',
  'messages_deleted',
  'emoji_actions',
  'message_char_units',
] as const;
export type CommunityMetric = (typeof COMMUNITY_METRICS)[number];

export const COMMUNITY_METRIC_LABELS: Record<CommunityMetric, string> = {
  messages: '発言数',
  voice_seconds: 'VC滞在時間',
  reactions_given: 'リアクション',
  reactions_received: 'もらったリアクション',
  minecraft_seconds: 'Minecraft',
  online_seconds: 'オンライン時間',
  messages_edited: 'メッセージ編集',
  messages_deleted: 'メッセージ削除',
  emoji_actions: '絵文字登録/変更/削除',
  message_char_units: '文字ポイント',
};

export function formatSeconds(value: number): string {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}時間 ${minutes}分`;
}

export function formatCommunityMetric(metric: string, value: number): string {
  if (metric.endsWith('_seconds')) return formatSeconds(value);
  if (metric === 'message_char_units') {
    // 半角=1unit(0.5pt)・全角等=2unit(1pt)で記録しているため、表示はunit/2のptへ変換する
    // (Botの apps/bot/src/activity/char-score.ts と同じ変換。整数BigInt保存のための単位)。
    const points = Math.round((value / 2) * 10) / 10;
    return `${points.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}pt`;
  }
  return value.toLocaleString('ja-JP');
}

export function resolveCommunityBucketDays(rangeDays: number): number {
  if (rangeDays <= 60) return 1;
  if (rangeDays <= 400) return 7;
  return 30;
}

export function communityDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function displayCommunityDate(value: Date): string {
  const [, month, day] = communityDateKey(value).split('-');
  return `${Number(month)}/${Number(day)}`;
}
