/** Hand-drawn 4×4 chibi Herta atlas; polished v2 remains available as a candidate. Keep tile order stable for both screen and PNG export. */
export const MBTI_ARTWORK_URL = '/mbti/herta-doodles-v3.webp';
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
  '星図とチェスの駒を持って考えるちびHerta',
  '試験管をのぞき込む好奇心いっぱいのちびHerta',
  '小さな旗を持って前を指すちびHerta',
  '電球と歯車を見せてウインクするちびHerta',
  '星のランタンを胸に抱くちびHerta',
  '本を抱えて花に囲まれた夢見るちびHerta',
  'ハートと一緒に手を差し伸べるちびHerta',
  '星の風船と一緒に跳ねる元気なちびHerta',
  '丸眼鏡でノートを確認するちびHerta',
  'うさぎのぬいぐるみを抱く優しいちびHerta',
  'クリップボードで段取りを確認するちびHerta',
  'ハートとお菓子を差し出すちびHerta',
  'ゴーグルを付けて小さなロボットを直すちびHerta',
  '紫の花の絵を描くちびHerta',
  'スケートボードに乗って遊ぶちびHerta',
  'マイクを持って星と歌うちびHerta',
] as const;
const ACCENTS = ['#c9a6f5', '#e1bcf8', '#b8b3ff', '#e7afe7'] as const;

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
