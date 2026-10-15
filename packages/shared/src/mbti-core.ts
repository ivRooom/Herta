import { MBTI_BALANCED_QUESTIONS } from './mbti-question-bank.js';

/**
 * AT(Assertive/Turbulent)は16personalities.com由来の「Identity」軸で、古典的な4軸
 * (EI/SN/TF/JP、Role付与の判定にも使うcomputeMbtiTypeの4文字タイプ)とは別の、5つ目の
 * 独立した軸として扱う。Role設定(mbtiManifest/MbtiPluginConfig)は4文字タイプのままで
 * 32通りへは拡張しない(スコープを広げすぎないための判断)。
 */
export const MBTI_AXES = ['EI', 'SN', 'TF', 'JP', 'AT'] as const;
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
  /** 省略時は旧設問と同じ正方向。セッションに保存し、途中で採点方向を変えない。 */
  direction?: 1 | -1;
  /** 同一軸内の観点。新規出題は観点ごとに層化抽出する。 */
  facet?: string;
  /** 独自に作成した設問文。 */
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
  AT: 12,
};

// v1の124問はIDと文面を維持する。進行中のセッション・過去の統計との互換用。
// 新しい診断ではv2の520問を、観点・採点方向のバランスを保って抽出する。
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
  // AT (24問) — 16personalities由来の「Identity」軸。当てはまるほどAssertive(-A)寄り。
  { id: 100, axis: 'AT', prompt: '多少のミスをしても気に病まない方だ' },
  { id: 101, axis: 'AT', prompt: '将来のことをあれこれ心配しすぎない方だ' },
  { id: 102, axis: 'AT', prompt: '人からどう思われるかはあまり気にしない方だ' },
  { id: 103, axis: 'AT', prompt: '大きなプレッシャーの中でも落ち着いていられる方だ' },
  { id: 104, axis: 'AT', prompt: '自分の判断に自信を持てる方だ' },
  { id: 105, axis: 'AT', prompt: '失敗してもすぐに切り替えられる方だ' },
  { id: 106, axis: 'AT', prompt: '批判されても必要以上に引きずらない方だ' },
  { id: 107, axis: 'AT', prompt: '締め切り前でも冷静でいられる方だ' },
  { id: 108, axis: 'AT', prompt: '自分の実力に満足している方だ' },
  { id: 109, axis: 'AT', prompt: '物事がうまくいかなくても焦らない方だ' },
  { id: 110, axis: 'AT', prompt: '他人と比べて落ち込むことは少ない方だ' },
  { id: 111, axis: 'AT', prompt: '完璧を求めすぎず自分を許せる方だ' },
  { id: 112, axis: 'AT', prompt: '緊張する場面でも普段通りでいられる方だ' },
  { id: 113, axis: 'AT', prompt: '過去の選択を後悔することは少ない方だ' },
  { id: 114, axis: 'AT', prompt: '結果が出るまで不安になりすぎない方だ' },
  { id: 115, axis: 'AT', prompt: '周囲の評価に振り回されない方だ' },
  { id: 116, axis: 'AT', prompt: '自分のペースを崩されにくい方だ' },
  { id: 117, axis: 'AT', prompt: 'トラブルが起きても冷静に対処できる方だ' },
  { id: 118, axis: 'AT', prompt: '今の自分に概ね満足している方だ' },
  { id: 119, axis: 'AT', prompt: '失敗を引きずらずすぐ次に進める方だ' },
  { id: 120, axis: 'AT', prompt: 'ストレスを感じても引きずらない方だ' },
  { id: 121, axis: 'AT', prompt: '新しい挑戦にも不安より期待を感じる方だ' },
  { id: 122, axis: 'AT', prompt: '自分を責めすぎることは少ない方だ' },
  { id: 123, axis: 'AT', prompt: '物事を深刻に捉えすぎない方だ' },
];

export const MBTI_QUESTION_POOL: readonly MbtiQuestion[] = [
  ...MBTI_QUESTION_PROMPTS,
  ...MBTI_BALANCED_QUESTIONS,
];

/** 保存済みの設問の採点方向を使う。旧セッションはdirectionがないため従来どおり。 */
export function scoreMbtiAnswer(
  question: { direction?: 1 | -1 },
  answer: MbtiLikertAnswer,
): number {
  return mbtiLikertWeight(answer) * (question.direction ?? 1);
}

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
 * 5軸×4観点から各3問を抽出する。各観点は両方向を含み、各軸で正逆6問ずつ。
 * EI/SNの13問目は未選択の設問から追加する。全体の順序もシャッフルする。
 * 乱数はテスト時のみ注入し、実際の質問・順序はセッション作成時に一度だけ確定する。
 */
export function selectMbtiQuestions(random: () => number = Math.random): MbtiQuestion[] {
  const selected: MbtiQuestion[] = [];
  for (const axis of MBTI_AXES) {
    const axisPool = MBTI_BALANCED_QUESTIONS.filter((question) => question.axis === axis);
    const facets = shuffleInPlace([...new Set(axisPool.map((question) => question.facet))], random);
    const axisSelected: MbtiQuestion[] = [];
    // 軸ごとに最初の方向もランダム化し、特定の観点へ常に同じ方向が多く出ないようにする。
    const firstDirection = random() < 0.5 ? 1 : -1;
    facets.forEach((facet, index) => {
      const majority = index % 2 === 0 ? firstDirection : -firstDirection;
      for (const direction of [1, -1] as const) {
        const candidates = shuffleInPlace(
          axisPool.filter(
            (question) => question.facet === facet && question.direction === direction,
          ),
          random,
        );
        axisSelected.push(...candidates.slice(0, direction === majority ? 2 : 1));
      }
    });
    const remaining = shuffleInPlace(
      axisPool.filter((question) => !axisSelected.some((item) => item.id === question.id)),
      random,
    );
    axisSelected.push(...remaining.slice(0, MBTI_AXIS_QUESTION_COUNTS[axis] - axisSelected.length));
    selected.push(...axisSelected);
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
  return { EI: 0, SN: 0, TF: 0, JP: 0, AT: 0 };
}

export function computeMbtiType(scores: MbtiScores): string {
  return (
    (scores.EI >= 0 ? 'E' : 'I') +
    (scores.SN >= 0 ? 'S' : 'N') +
    (scores.TF >= 0 ? 'T' : 'F') +
    (scores.JP >= 0 ? 'J' : 'P')
  );
}

export interface MbtiIdentityInfo {
  label: string;
  description: string;
}

export const MBTI_IDENTITY_INFO: Record<'A' | 'T', MbtiIdentityInfo> = {
  A: {
    label: 'アサーティブ',
    description: '自信があり、プレッシャーやストレスに動じにくく、物事に動じず安定しているタイプ。',
  },
  T: {
    label: 'タービュレント',
    description: '向上心が強く、完璧を目指すあまり自分に厳しく、ストレスを感じやすいタイプ。',
  },
};

/**
 * 16personalities由来の「Identity」軸(-A/-T)。computeMbtiTypeとは独立した5つ目の軸で、
 * Role付与の判定には使わない(Role設定は4文字タイプのまま)。
 */
export function computeMbtiIdentity(scores: MbtiScores): 'A' | 'T' {
  return scores.AT >= 0 ? 'A' : 'T';
}

/** axisの正方向側の文字(E/S/T/J)の強さを0〜100の百分率で返す。0と50はタイブレークで正方向寄りに丸める。 */
export function computeMbtiAxisPercent(scores: MbtiScores, axis: MbtiAxis): number {
  const maxScore = MBTI_AXIS_QUESTION_COUNTS[axis] * 2;
  if (maxScore <= 0) return 50;
  const percent = 50 + (scores[axis] / maxScore) * 50;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

export type MbtiLegacyAxis = 'EI' | 'SN' | 'TF' | 'JP';

export interface MbtiSessionAnswer {
  questionIndex: number;
  axis: MbtiAxis;
  answer: MbtiLikertAnswer;
}

export interface MbtiLegacyAnswer {
  questionIndex: number;
  axis: MbtiLegacyAxis;
  answer: MbtiLikertAnswer;
}

const LEGACY_PERSISTABLE_AXES = new Set<MbtiAxis>(['EI', 'SN', 'TF', 'JP']);

/**
 * @herta/dbのMbtiQuizAnswerInputが受け付ける従来の4軸分の回答だけに絞り込む(AT軸は対象外)。
 * @herta/dbの統計テーブルは5軸化せず4軸のまま維持する設計のため、Discord/Web両方の回答フローが
 * ここを経由してから統計記録用の`recordMbtiQuizCompletion`へ渡す。
 */
export function toLegacyMbtiAnswers(answers: readonly MbtiSessionAnswer[]): MbtiLegacyAnswer[] {
  return answers
    .filter((entry): entry is MbtiSessionAnswer & { axis: MbtiLegacyAxis } =>
      LEGACY_PERSISTABLE_AXES.has(entry.axis),
    )
    .map((entry) => ({
      questionIndex: entry.questionIndex,
      axis: entry.axis,
      answer: entry.answer,
    }));
}
