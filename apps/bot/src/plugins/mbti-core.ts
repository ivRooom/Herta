export const MBTI_AXES = ['EI', 'SN', 'TF', 'JP'] as const;
export type MbtiAxis = (typeof MBTI_AXES)[number];
export type MbtiScores = Record<MbtiAxis, number>;

export const MBTI_LIKERT_ANSWERS = [
  'agree',
  'slightly_agree',
  'neutral',
  'slightly_disagree',
  'disagree',
] as const;
export type MbtiLikertAnswer = (typeof MBTI_LIKERT_ANSWERS)[number];

const LIKERT_WEIGHTS: Record<MbtiLikertAnswer, number> = {
  agree: 2,
  slightly_agree: 1,
  neutral: 0,
  slightly_disagree: -1,
  disagree: -2,
};

const LIKERT_LABELS: Record<MbtiLikertAnswer, string> = {
  agree: '当てはまる',
  slightly_agree: 'やや当てはまる',
  neutral: 'どちらでもない',
  slightly_disagree: 'やや当てはまらない',
  disagree: '当てはまらない',
};

export function isMbtiLikertAnswer(value: string): value is MbtiLikertAnswer {
  return (MBTI_LIKERT_ANSWERS as readonly string[]).includes(value);
}

export function mbtiLikertLabel(answer: MbtiLikertAnswer): string {
  return LIKERT_LABELS[answer];
}

export function mbtiLikertWeight(answer: MbtiLikertAnswer): number {
  return LIKERT_WEIGHTS[answer];
}

export interface MbtiQuestion {
  axis: MbtiAxis;
  /** 「当てはまる」と答えるとaxisの正方向(EI:E / SN:S / TF:T / JP:J)へ加点される設問文。 */
  prompt: string;
}

// 各軸12〜13問、計50問。5段階Likertのため、以前の2択(奇数問)時のような
// 「合計が0にならない」保証はなく、タイブレーク処理が必要(computeMbtiTypeで正方向優先)。
export const MBTI_QUESTIONS: readonly MbtiQuestion[] = [
  // EI (13問)
  { axis: 'EI', prompt: '大人数で集まるとエネルギーが湧いてくる方だ' },
  { axis: 'EI', prompt: '初対面の人ともすぐに打ち解けられる方だ' },
  { axis: 'EI', prompt: '考えるより先に声に出して話し始めることが多い' },
  { axis: 'EI', prompt: '賑やかな場所にいると気分が上がる方だ' },
  { axis: 'EI', prompt: '自分から話しかけるのが得意な方だ' },
  { axis: 'EI', prompt: '一人で過ごすより誰かと過ごす方が好きだ' },
  { axis: 'EI', prompt: '大勢の前で話すことに抵抗がない方だ' },
  { axis: 'EI', prompt: '新しい人間関係を広げるのが好きな方だ' },
  { axis: 'EI', prompt: '声に出しながら考えを整理する方だ' },
  { axis: 'EI', prompt: 'パーティーやイベントに誘われると嬉しい方だ' },
  { axis: 'EI', prompt: '沈黙が続くと自分から話題を振りたくなる方だ' },
  { axis: 'EI', prompt: '週末は外に出て人と会いたい方だ' },
  { axis: 'EI', prompt: 'グループでの作業に活気を感じる方だ' },
  // SN (13問)
  { axis: 'SN', prompt: '具体的な事実やデータを重視して考える方だ' },
  { axis: 'SN', prompt: '今、目の前にあることに集中するのが得意な方だ' },
  { axis: 'SN', prompt: '経験したことをもとに物事を判断する方だ' },
  { axis: 'SN', prompt: '抽象的な理論より実用的な情報を好む方だ' },
  { axis: 'SN', prompt: '細かい手順やマニュアルを丁寧に守る方だ' },
  { axis: 'SN', prompt: '五感で確かめられることを信じる方だ' },
  { axis: 'SN', prompt: '現実的で地に足のついた考え方をする方だ' },
  { axis: 'SN', prompt: '過去の成功パターンを重視する方だ' },
  { axis: 'SN', prompt: '目の前の作業を一つずつ着実にこなすのが好きな方だ' },
  { axis: 'SN', prompt: '数字や事実で説明されると納得しやすい方だ' },
  { axis: 'SN', prompt: '実際に手を動かして学ぶのが得意な方だ' },
  { axis: 'SN', prompt: '空想より現実的な話をする方が落ち着く方だ' },
  { axis: 'SN', prompt: '決まった手順があると安心する方だ' },
  // TF (12問)
  { axis: 'TF', prompt: '決断するときは感情より論理を優先する方だ' },
  { axis: 'TF', prompt: '率直な指摘は相手のためにも必要だと思う方だ' },
  { axis: 'TF', prompt: '議論では場の調和より正しさの方が大事だと思う方だ' },
  { axis: 'TF', prompt: '感情に流されず淡々と物事を判断する方だ' },
  { axis: 'TF', prompt: '効率や合理性を重視して行動する方だ' },
  { axis: 'TF', prompt: '批判されても人格否定とは受け取らない方だ' },
  { axis: 'TF', prompt: '客観的なデータをもとに結論を出したい方だ' },
  { axis: 'TF', prompt: '公平さのためなら厳しい判断も受け入れられる方だ' },
  { axis: 'TF', prompt: '意思決定に個人的な感情を挟みたくない方だ' },
  { axis: 'TF', prompt: '筋道立てて説明されると納得しやすい方だ' },
  { axis: 'TF', prompt: '議論で感情的になることは少ない方だ' },
  { axis: 'TF', prompt: 'ルールや基準は例外なく適用すべきだと思う方だ' },
  // JP (12問)
  { axis: 'JP', prompt: '行動する前に計画を立てておきたい方だ' },
  { axis: 'JP', prompt: '締め切りは早めに終わらせておきたい方だ' },
  { axis: 'JP', prompt: '物事がきちんと整理されていると安心する方だ' },
  { axis: 'JP', prompt: '予定はできるだけ早く決めたい方だ' },
  { axis: 'JP', prompt: '突然の予定変更にストレスを感じる方だ' },
  { axis: 'JP', prompt: 'To-Doリストを作って管理するのが好きな方だ' },
  { axis: 'JP', prompt: '旅行はスケジュールをしっかり決めたい方だ' },
  { axis: 'JP', prompt: '部屋や机はきちんと片付いている方が落ち着く方だ' },
  { axis: 'JP', prompt: '物事を最後までやり遂げないと気が済まない方だ' },
  { axis: 'JP', prompt: '曖昧な状態が続くと落ち着かない方だ' },
  { axis: 'JP', prompt: '期限のあるタスクは前倒しで進めたい方だ' },
  { axis: 'JP', prompt: 'ルーティンが決まっていると安心する方だ' },
] as const;

export const MBTI_AXIS_QUESTION_COUNTS: Record<MbtiAxis, number> = MBTI_AXES.reduce(
  (counts, axis) => {
    counts[axis] = MBTI_QUESTIONS.filter((question) => question.axis === axis).length;
    return counts;
  },
  {} as Record<MbtiAxis, number>,
);

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

/** axisの正方向側の文字(E/S/T/J)の強さを0〜100の百分率で返す。0と50はタイブレークで正方向寄りに丸める。 */
export function computeMbtiAxisPercent(scores: MbtiScores, axis: MbtiAxis): number {
  const maxScore = MBTI_AXIS_QUESTION_COUNTS[axis] * 2;
  if (maxScore <= 0) return 50;
  const percent = 50 + (scores[axis] / maxScore) * 50;
  return Math.round(Math.min(100, Math.max(0, percent)));
}
