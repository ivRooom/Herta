import {
  MBTI_AXES,
  MBTI_TYPES,
  MBTI_IDENTITY_INFO,
  type MbtiScores,
} from '@herta/shared/mbti-core';
import { createMbtiReport, mbtiShareSearch } from '@herta/shared/mbti-report';

export const MBTI_SHARE_IMAGE_PATH = '/api/mbti/share-image';
export const MBTI_SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

const SITE_NAME = 'Herta';
const GENERIC_TITLE = '性格診断レポート | Herta';
const GENERIC_DESCRIPTION =
  'Herta の性格診断レポート。5つの軸の回答傾向から、あなたのタイプを確認できます。';
const IMAGE_BRAND = 'HERTA 性格診断';
const IMAGE_ESTIMATED_BADGE = '推定';
const IMAGE_FALLBACK_TITLE = '性格診断レポート';
const IMAGE_FALLBACK_SUBTITLE = '5つの軸で見る、あなたの回答傾向';
const IMAGE_FOOTER = 'herta.ivrm.jp/mbti';
const IMAGE_BALANCED = '拮抗';

export interface MbtiSharePreviewAxis {
  axis: string;
  labels: [string, string];
  /** 優勢な側(0: E/S/T/J/A, 1: I/N/F/P/T)。 */
  side: 0 | 1;
  /** 優勢な側の割合(50〜100)。 */
  percent: number;
  balanced: boolean;
}

export interface MbtiSharePreview {
  code: string;
  title: string;
  identityLabel: string;
  estimated: boolean;
  axes: MbtiSharePreviewAxis[];
}

/**
 * 共有URLのスコア(軸ごとの集計値のみ)からプレビュー用の表示内容を作る。
 * 名前・Discord ID・sessionなどの個人情報は入力にも出力にも含めない。
 */
export function createMbtiSharePreview(scores: MbtiScores, estimated: boolean): MbtiSharePreview {
  const report = createMbtiReport(scores);
  return {
    code: `${report.resultType}-${report.identity}`,
    title: report.title,
    identityLabel: report.identityLabel,
    estimated,
    axes: report.axes.map((axis) => {
      const side = scores[axis.axis] >= 0 ? 0 : 1;
      return {
        axis: axis.axis,
        labels: axis.labels,
        side,
        percent: side === 0 ? axis.percent : 100 - axis.percent,
        balanced: axis.balanced,
      };
    }),
  };
}

function axisSummary(axis: MbtiSharePreviewAxis): string {
  const letter = axis.labels[axis.side].split(' ').at(-1);
  return `${letter} ${axis.percent}%`;
}

export function mbtiShareMetadataText(
  scores: MbtiScores | null,
  estimated: boolean,
): { title: string; description: string } {
  if (!scores) return { title: GENERIC_TITLE, description: GENERIC_DESCRIPTION };
  const preview = createMbtiSharePreview(scores, estimated);
  const summary = createMbtiReport(scores).summary;
  const prefix = estimated ? '【推定】' : '';
  return {
    title: `${prefix}${preview.code} ${preview.title} | ${SITE_NAME} 性格診断`,
    description: `${prefix}${summary} ${preview.axes.map(axisSummary).join(' / ')}`,
  };
}

/** OG画像URLのpath+query。スコアが無効なときは汎用画像を指す。 */
export function mbtiShareImagePath(scores: MbtiScores | null, estimated: boolean): string {
  if (!scores) return MBTI_SHARE_IMAGE_PATH;
  return `${MBTI_SHARE_IMAGE_PATH}?${mbtiShareSearch(scores, estimated)}`;
}

export const MBTI_SHARE_IMAGE_TEXT = {
  brand: IMAGE_BRAND,
  estimatedBadge: IMAGE_ESTIMATED_BADGE,
  fallbackTitle: IMAGE_FALLBACK_TITLE,
  fallbackSubtitle: IMAGE_FALLBACK_SUBTITLE,
  footer: IMAGE_FOOTER,
  balanced: IMAGE_BALANCED,
} as const;

/**
 * OG画像に描画し得る全文字。`api/mbti/share-image` に同梱するsubsetフォントはこの文字集合から作る。
 * テストでフォントの収録文字と突き合わせ、タイプ名や軸ラベルの変更で豆腐化しないようにする。
 */
export function mbtiShareImageRequiredCharacters(): Set<string> {
  const texts: string[] = [
    ...Object.values(MBTI_SHARE_IMAGE_TEXT),
    ...Object.values(MBTI_TYPES).map((type) => type.title),
    ...Object.values(MBTI_IDENTITY_INFO).map((info) => info.label),
  ];
  const zero = Object.fromEntries(MBTI_AXES.map((axis) => [axis, 0])) as MbtiScores;
  for (const axis of createMbtiReport(zero).axes) texts.push(...axis.labels);
  // コード・割合・区切り記号に使うASCII
  texts.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%-./· ');
  const characters = new Set<string>();
  for (const text of texts) for (const character of text) characters.add(character);
  return characters;
}
