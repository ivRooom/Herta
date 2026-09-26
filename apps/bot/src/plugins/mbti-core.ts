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
  /** 出題プール内での固定ID。人によって選ばれる設問が変わっても集計で同一設問だと分かるようにする。 */
  id: number;
  axis: MbtiAxis;
  /** 「当てはまる」と答えるとaxisの正方向(EI:E / SN:S / TF:T / JP:J)へ加点される設問文。 */
  prompt: string;
}

/**
 * 1回の診断で各軸から抽出する設問数。出題プール(MBTI_QUESTION_POOL)を拡張しても
 * この値は変えない設計にし、スコア計算(computeMbtiAxisPercentの最大値)への影響を防ぐ。
 */
export const MBTI_AXIS_QUESTION_COUNTS: Record<MbtiAxis, number> = {
  EI: 13,
  SN: 13,
  TF: 12,
  JP: 12,
};

// 各軸26/26/24/24問、計100問のプール。5段階Likertのため、以前の2択(奇数問)時のような
// 「合計が0にならない」保証はなく、タイブレーク処理が必要(computeMbtiTypeで正方向優先)。
// selectMbtiQuestions()が人ごとにMBTI_AXIS_QUESTION_COUNTS分をランダム抽出し、順序も
// シャッフルするため、diagnosisごとに出題される設問・順序が変わる。
const MBTI_QUESTION_PROMPTS: readonly MbtiQuestion[] = [
  // EI (26問)
  { id: 0, axis: 'EI', prompt: '大人数で集まるとエネルギーが湧いてくる方だ' },
  { id: 1, axis: 'EI', prompt: '初対面の人ともすぐに打ち解けられる方だ' },
  { id: 2, axis: 'EI', prompt: '考えるより先に声に出して話し始めることが多い' },
  { id: 3, axis: 'EI', prompt: '賑やかな場所にいると気分が上がる方だ' },
  { id: 4, axis: 'EI', prompt: '自分から話しかけるのが得意な方だ' },
  { id: 5, axis: 'EI', prompt: '一人で過ごすより誰かと過ごす方が好きだ' },
  { id: 6, axis: 'EI', prompt: '大勢の前で話すことに抵抗がない方だ' },
  { id: 7, axis: 'EI', prompt: '新しい人間関係を広げるのが好きな方だ' },
  { id: 8, axis: 'EI', prompt: '声に出しながら考えを整理する方だ' },
  { id: 9, axis: 'EI', prompt: 'パーティーやイベントに誘われると嬉しい方だ' },
  { id: 10, axis: 'EI', prompt: '沈黙が続くと自分から話題を振りたくなる方だ' },
  { id: 11, axis: 'EI', prompt: '週末は外に出て人と会いたい方だ' },
  { id: 12, axis: 'EI', prompt: 'グループでの作業に活気を感じる方だ' },
  { id: 13, axis: 'EI', prompt: '誰かと過ごす時間が長いほど元気が出る方だ' },
  { id: 14, axis: 'EI', prompt: '気になったことはすぐ声に出して確認したくなる方だ' },
  { id: 15, axis: 'EI', prompt: '初対面の相手にも自分から話しかけられる方だ' },
  { id: 16, axis: 'EI', prompt: '賑やかな飲み会やイベントに顔を出すのが好きな方だ' },
  { id: 17, axis: 'EI', prompt: 'チームで動く方が一人で動くより楽しいと感じる方だ' },
  { id: 18, axis: 'EI', prompt: '思いついたアイデアをすぐ誰かに話したくなる方だ' },
  { id: 19, axis: 'EI', prompt: '人前に立って発表するのは苦にならない方だ' },
  { id: 20, axis: 'EI', prompt: '知り合いが多いコミュニティに参加するのが楽しい方だ' },
  { id: 21, axis: 'EI', prompt: '長時間一人でいると刺激が足りないと感じる方だ' },
  { id: 22, axis: 'EI', prompt: '会話のキャッチボールが多い方が心地よい方だ' },
  { id: 23, axis: 'EI', prompt: 'SNSやチャットでも積極的に発信する方だ' },
  { id: 24, axis: 'EI', prompt: 'みんなでワイワイ盛り上がる場が好きな方だ' },
  { id: 25, axis: 'EI', prompt: '初めての集まりでも自分から輪に入っていける方だ' },
  // SN (26問)
  { id: 26, axis: 'SN', prompt: '具体的な事実やデータを重視して考える方だ' },
  { id: 27, axis: 'SN', prompt: '今、目の前にあることに集中するのが得意な方だ' },
  { id: 28, axis: 'SN', prompt: '経験したことをもとに物事を判断する方だ' },
  { id: 29, axis: 'SN', prompt: '抽象的な理論より実用的な情報を好む方だ' },
  { id: 30, axis: 'SN', prompt: '細かい手順やマニュアルを丁寧に守る方だ' },
  { id: 31, axis: 'SN', prompt: '五感で確かめられることを信じる方だ' },
  { id: 32, axis: 'SN', prompt: '現実的で地に足のついた考え方をする方だ' },
  { id: 33, axis: 'SN', prompt: '過去の成功パターンを重視する方だ' },
  { id: 34, axis: 'SN', prompt: '目の前の作業を一つずつ着実にこなすのが好きな方だ' },
  { id: 35, axis: 'SN', prompt: '数字や事実で説明されると納得しやすい方だ' },
  { id: 36, axis: 'SN', prompt: '実際に手を動かして学ぶのが得意な方だ' },
  { id: 37, axis: 'SN', prompt: '空想より現実的な話をする方が落ち着く方だ' },
  { id: 38, axis: 'SN', prompt: '決まった手順があると安心する方だ' },
  { id: 39, axis: 'SN', prompt: '理論より実際に起きた事例を重視する方だ' },
  { id: 40, axis: 'SN', prompt: '目に見える成果を確認しながら進めたい方だ' },
  { id: 41, axis: 'SN', prompt: 'これまでのやり方を踏襲する方が安心する方だ' },
  { id: 42, axis: 'SN', prompt: '抽象的なアイデアより具体的な手順を求める方だ' },
  { id: 43, axis: 'SN', prompt: '実際に試してみて確かめるのが好きな方だ' },
  { id: 44, axis: 'SN', prompt: '詳細な情報を一つずつ確認しながら進める方だ' },
  { id: 45, axis: 'SN', prompt: '経験に基づいたアドバイスを信頼する方だ' },
  { id: 46, axis: 'SN', prompt: '現状の事実をまず正確に把握したい方だ' },
  { id: 47, axis: 'SN', prompt: '説明書やマニュアルに沿って進める方が安心する方だ' },
  { id: 48, axis: 'SN', prompt: '新しい可能性より確実な方法を選びたい方だ' },
  { id: 49, axis: 'SN', prompt: 'データや記録をもとに判断する方だ' },
  { id: 50, axis: 'SN', prompt: '目の前の作業に集中して取り組む方だ' },
  { id: 51, axis: 'SN', prompt: '実務的で現実に即した解決策を好む方だ' },
  // TF (24問)
  { id: 52, axis: 'TF', prompt: '決断するときは感情より論理を優先する方だ' },
  { id: 53, axis: 'TF', prompt: '率直な指摘は相手のためにも必要だと思う方だ' },
  { id: 54, axis: 'TF', prompt: '議論では場の調和より正しさの方が大事だと思う方だ' },
  { id: 55, axis: 'TF', prompt: '感情に流されず淡々と物事を判断する方だ' },
  { id: 56, axis: 'TF', prompt: '効率や合理性を重視して行動する方だ' },
  { id: 57, axis: 'TF', prompt: '批判されても人格否定とは受け取らない方だ' },
  { id: 58, axis: 'TF', prompt: '客観的なデータをもとに結論を出したい方だ' },
  { id: 59, axis: 'TF', prompt: '公平さのためなら厳しい判断も受け入れられる方だ' },
  { id: 60, axis: 'TF', prompt: '意思決定に個人的な感情を挟みたくない方だ' },
  { id: 61, axis: 'TF', prompt: '筋道立てて説明されると納得しやすい方だ' },
  { id: 62, axis: 'TF', prompt: '議論で感情的になることは少ない方だ' },
  { id: 63, axis: 'TF', prompt: 'ルールや基準は例外なく適用すべきだと思う方だ' },
  { id: 64, axis: 'TF', prompt: '決断の場面では感情より結果の合理性を重視する方だ' },
  { id: 65, axis: 'TF', prompt: '議論では正確さを優先し情に流されない方だ' },
  { id: 66, axis: 'TF', prompt: '問題点は率直に指摘する方が良いと思う方だ' },
  { id: 67, axis: 'TF', prompt: '感情的な反応より論理的な説明を優先する方だ' },
  { id: 68, axis: 'TF', prompt: 'ルールに基づいた公平な判断を重視する方だ' },
  { id: 69, axis: 'TF', prompt: '意見が対立しても事実に基づいて結論を出したい方だ' },
  { id: 70, axis: 'TF', prompt: '効率を重視して無駄を省きたい方だ' },
  { id: 71, axis: 'TF', prompt: '分析的に物事を捉えるのが得意な方だ' },
  { id: 72, axis: 'TF', prompt: '批判は成長のために必要だと考える方だ' },
  { id: 73, axis: 'TF', prompt: '感情より整合性を重視して話を進める方だ' },
  { id: 74, axis: 'TF', prompt: '客観的な基準で評価されたい方だ' },
  { id: 75, axis: 'TF', prompt: '議論の場では冷静でいられる方だ' },
  // JP (24問)
  { id: 76, axis: 'JP', prompt: '行動する前に計画を立てておきたい方だ' },
  { id: 77, axis: 'JP', prompt: '締め切りは早めに終わらせておきたい方だ' },
  { id: 78, axis: 'JP', prompt: '物事がきちんと整理されていると安心する方だ' },
  { id: 79, axis: 'JP', prompt: '予定はできるだけ早く決めたい方だ' },
  { id: 80, axis: 'JP', prompt: '突然の予定変更にストレスを感じる方だ' },
  { id: 81, axis: 'JP', prompt: 'To-Doリストを作って管理するのが好きな方だ' },
  { id: 82, axis: 'JP', prompt: '旅行はスケジュールをしっかり決めたい方だ' },
  { id: 83, axis: 'JP', prompt: '部屋や机はきちんと片付いている方が落ち着く方だ' },
  { id: 84, axis: 'JP', prompt: '物事を最後までやり遂げないと気が済まない方だ' },
  { id: 85, axis: 'JP', prompt: '曖昧な状態が続くと落ち着かない方だ' },
  { id: 86, axis: 'JP', prompt: '期限のあるタスクは前倒しで進めたい方だ' },
  { id: 87, axis: 'JP', prompt: 'ルーティンが決まっていると安心する方だ' },
  { id: 88, axis: 'JP', prompt: '事前に計画を立てて動く方が安心する方だ' },
  { id: 89, axis: 'JP', prompt: 'やるべきことは早めに片付けたい方だ' },
  { id: 90, axis: 'JP', prompt: 'スケジュールが決まっている方が落ち着く方だ' },
  { id: 91, axis: 'JP', prompt: '物事は順序立てて進めたい方だ' },
  { id: 92, axis: 'JP', prompt: '予定が急に変わるとストレスを感じる方だ' },
  { id: 93, axis: 'JP', prompt: 'タスクは早めに終わらせておきたい方だ' },
  { id: 94, axis: 'JP', prompt: '計画通りに進んでいるか確認したくなる方だ' },
  { id: 95, axis: 'JP', prompt: '整理整頓された環境が落ち着く方だ' },
  { id: 96, axis: 'JP', prompt: '締め切りより早く仕上げることを目指す方だ' },
  { id: 97, axis: 'JP', prompt: '決まった手順に沿って進めると安心する方だ' },
  { id: 98, axis: 'JP', prompt: '先の予定を把握しておきたい方だ' },
  { id: 99, axis: 'JP', prompt: 'やり残しがあると気になってしまう方だ' },
];

export const MBTI_QUESTION_POOL: readonly MbtiQuestion[] = MBTI_QUESTION_PROMPTS;

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = items[i]!;
    items[i] = items[j]!;
    items[j] = temp;
  }
  return items;
}

/**
 * 出題プールから各軸MBTI_AXIS_QUESTION_COUNTS分をランダムに抽出し、全体の出題順序も
 * シャッフルして返す。人によって選ばれる設問・順序が変わるが、各軸の設問数自体は
 * 固定のためスコア計算(computeMbtiAxisPercent)に影響しない。
 */
export function selectMbtiQuestions(random: () => number = Math.random): MbtiQuestion[] {
  const selected: MbtiQuestion[] = [];
  for (const axis of MBTI_AXES) {
    const axisPool = MBTI_QUESTION_POOL.filter((question) => question.axis === axis);
    const shuffledPool = shuffleInPlace([...axisPool], random);
    selected.push(...shuffledPool.slice(0, MBTI_AXIS_QUESTION_COUNTS[axis]));
  }
  return shuffleInPlace(selected, random);
}

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
