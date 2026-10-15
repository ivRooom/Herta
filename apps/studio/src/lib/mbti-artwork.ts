/** Original 4×4 illustration atlas. Keep tile order stable for both screen and PNG export. */
export const MBTI_ARTWORK_URL = '/mbti/personality-worlds-v1.webp';
const TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;
const DESCRIPTIONS = [
  '星図と望遠鏡のある未来の観測所',
  'フラスコと幾何学模型のある研究室',
  '旗と階段状の塔がある指揮ステーション',
  '歯車と電球が並ぶ発明工房',
  '小道を照らす静かな灯台',
  '開いた本と花のアーチがある空想の庭',
  'ランタンに囲まれた開放的な広場',
  '花畑から飛び立つカラフルな気球',
  '時計と整然とした本棚のある書庫',
  '暖かな灯りのある小さな家',
  '設計図をもとに造る橋と塔',
  'お茶と花を囲む庭のテーブル',
  '道具と小さなロボットがある工作室',
  '絵の具とイーゼルのある庭のアトリエ',
  '曲線のコースとスケートボードのある島',
  '楽器とスポットライトのある音楽ステージ',
] as const;
const ACCENTS = ['#c9a6f5', '#9af3d5', '#f6bd9b', '#f4da91'] as const;

export function getMbtiArtwork(type: string) {
  const index = TYPES.findIndex((entry) => entry === type);
  if (index < 0) return null;
  return {
    index,
    column: index % 4,
    row: Math.floor(index / 4),
    description: DESCRIPTIONS[index]!,
    accent: ACCENTS[Math.floor(index / 4)]!,
    position: `${((index % 4) / 3) * 100}% ${(Math.floor(index / 4) / 3) * 100}%`,
  };
}
