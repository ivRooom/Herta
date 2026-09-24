export const MBTI_AXES = ['EI', 'SN', 'TF', 'JP'] as const;
export type MbtiAxis = (typeof MBTI_AXES)[number];
export type MbtiScores = Record<MbtiAxis, number>;

export interface MbtiQuestion {
  axis: MbtiAxis;
  prompt: string;
  /** 正方向を選んだ場合に加点される選択肢ラベル (EI:E / SN:S / TF:T / JP:J)。 */
  optionPositive: string;
  /** 負方向を選んだ場合に加点される選択肢ラベル (EI:I / SN:N / TF:F / JP:P)。 */
  optionNegative: string;
}

// 各軸3問ずつ、計12問。3問(奇数)構成のためscoreの合計は常に奇数になり0にはならず、
// タイブレークが不要になる。
export const MBTI_QUESTIONS: readonly MbtiQuestion[] = [
  {
    axis: 'EI',
    prompt: '大人数で集まるとエネルギーが湧いてくる方だ',
    optionPositive: '当てはまる (E)',
    optionNegative: '当てはまらない (I)',
  },
  {
    axis: 'EI',
    prompt: '初対面の人ともすぐに打ち解けられる方だ',
    optionPositive: '当てはまる (E)',
    optionNegative: '当てはまらない (I)',
  },
  {
    axis: 'EI',
    prompt: '考えるより先に声に出して話し始めることが多い',
    optionPositive: '当てはまる (E)',
    optionNegative: '当てはまらない (I)',
  },
  {
    axis: 'SN',
    prompt: '具体的な事実やデータを重視して考える方だ',
    optionPositive: '当てはまる (S)',
    optionNegative: '当てはまらない (N)',
  },
  {
    axis: 'SN',
    prompt: '今、目の前にあることに集中するのが得意だ',
    optionPositive: '当てはまる (S)',
    optionNegative: '当てはまらない (N)',
  },
  {
    axis: 'SN',
    prompt: '経験したことをもとに物事を判断する方だ',
    optionPositive: '当てはまる (S)',
    optionNegative: '当てはまらない (N)',
  },
  {
    axis: 'TF',
    prompt: '決断するときは感情より論理を優先する方だ',
    optionPositive: '当てはまる (T)',
    optionNegative: '当てはまらない (F)',
  },
  {
    axis: 'TF',
    prompt: '率直な指摘は相手のためにも必要だと思う',
    optionPositive: '当てはまる (T)',
    optionNegative: '当てはまらない (F)',
  },
  {
    axis: 'TF',
    prompt: '議論では場の調和より正しさの方が大事だと思う',
    optionPositive: '当てはまる (T)',
    optionNegative: '当てはまらない (F)',
  },
  {
    axis: 'JP',
    prompt: '行動する前に計画を立てておきたい方だ',
    optionPositive: '当てはまる (J)',
    optionNegative: '当てはまらない (P)',
  },
  {
    axis: 'JP',
    prompt: '締め切りは早めに終わらせておきたい方だ',
    optionPositive: '当てはまる (J)',
    optionNegative: '当てはまらない (P)',
  },
  {
    axis: 'JP',
    prompt: '物事がきちんと整理されていると安心する方だ',
    optionPositive: '当てはまる (J)',
    optionNegative: '当てはまらない (P)',
  },
] as const;

export interface MbtiTypeInfo {
  title: string;
  description: string;
}

export const MBTI_TYPES: Record<string, MbtiTypeInfo> = {
  INTJ: { title: '建築家', description: '独創的な戦略で物事を計画し、着実にやり遂げるタイプ。' },
  INTP: { title: '論理学者', description: '知的好奇心が強く、理論やしくみを深く追求するタイプ。' },
  ENTJ: { title: '指揮官', description: '大胆でカリスマ性があり、目標達成へ周囲を導くタイプ。' },
  ENTP: { title: '討論者', description: '発想が豊かで、議論や新しい挑戦を楽しむタイプ。' },
  INFJ: {
    title: '提唱者',
    description: '静かながら情熱的で、理想の実現に向けて粘り強く動くタイプ。',
  },
  INFP: {
    title: '仲介者',
    description: '思いやりがあり、自分の価値観を大切にする理想主義者タイプ。',
  },
  ENFJ: { title: '主人公', description: '人を惹きつけるカリスマ性を持ち、周囲を鼓舞するタイプ。' },
  ENFP: { title: '広報運動家', description: '情熱的で社交的、可能性を見つけるのが得意なタイプ。' },
  ISTJ: { title: '管理者', description: '実直で責任感が強く、決めたことを着実にこなすタイプ。' },
  ISFJ: { title: '擁護者', description: '献身的で温かく、周囲をそっと支えるタイプ。' },
  ESTJ: {
    title: '幹部',
    description: '物事を秩序立てて進める、優れた管理・運営能力を持つタイプ。',
  },
  ESFJ: {
    title: '領事官',
    description: '思いやりがあり社交的で、周囲との調和を大切にするタイプ。',
  },
  ISTP: { title: '巨匠', description: '大胆で実践的、道具やしくみを使いこなすのが得意なタイプ。' },
  ISFP: { title: '冒険家', description: '柔軟で魅力的、自分らしさを大切にする芸術家肌タイプ。' },
  ESTP: { title: '起業家', description: 'エネルギッシュで機転が利き、今この瞬間を楽しむタイプ。' },
  ESFP: { title: 'エンターテイナー', description: '自由奔放で周囲を楽しませるのが好きなタイプ。' },
};

export function createEmptyMbtiScores(): MbtiScores {
  return { EI: 0, SN: 0, TF: 0, JP: 0 };
}

export function computeMbtiType(scores: MbtiScores): string {
  return (
    (scores.EI >= 0 ? 'E' : 'I') +
    (scores.SN >= 0 ? 'S' : 'N') +
    (scores.TF >= 0 ? 'T' : 'F') +
    (scores.JP >= 0 ? 'J' : 'P')
  );
}
