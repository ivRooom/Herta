import {
  MBTI_AXES,
  MBTI_AXIS_QUESTION_COUNTS,
  MBTI_TYPES,
  MBTI_IDENTITY_INFO,
  computeMbtiAxisPercent,
  computeMbtiType,
  computeMbtiIdentity,
  type MbtiAxis,
  type MbtiScores,
} from './mbti-core.js';

const AXIS_COPY: Record<
  MbtiAxis,
  {
    name: string;
    labels: [string, string];
    poles: [
      {
        description: string;
        strength: string;
        caution: string;
        relationship: string;
        action: string;
      },
      {
        description: string;
        strength: string;
        caution: string;
        relationship: string;
        action: string;
      },
    ];
  }
> = {
  EI: {
    name: 'エネルギーの向かう先',
    labels: ['外向 E', '内向 I'],
    poles: [
      {
        description:
          '交流や対話を通じて考えを広げ、気力を得やすい傾向です。人と関わる機会があると持ち味を発揮しやすいでしょう。',
        strength: '自分から交流のきっかけを作り、対話から新しい動きを生み出せる。',
        caution: '予定を詰めすぎると疲れに気づきにくいことも。静かに振り返る時間も確保しましょう。',
        relationship: '考えを話しながら整理することを伝え、相手が考える間も待ってみましょう。',
        action: '相談したいことを一人に話したあと、自分の結論を短く書き留めてみる。',
      },
      {
        description:
          '一人で考えたり、落ち着いた環境で過ごしたりする時間から気力を得やすい傾向です。少人数で深く関わる場が合いやすいでしょう。',
        strength: '内側で考えを深め、落ち着いた対話で相手と関係を育てられる。',
        caution: '考えがまとまるのを待ちすぎると、周囲には意図が伝わらないこともあります。',
        relationship: 'すぐに答えにくいときは「少し考えてから返すね」とひと言添えてみましょう。',
        action: '話し合いの前に伝えたいことを三つメモし、一つだけでも共有してみる。',
      },
    ],
  },
  SN: {
    name: '情報の受け取り方',
    labels: ['感覚 S', '直観 N'],
    poles: [
      {
        description:
          '具体的な情報や経験を手がかりに理解を進めやすい傾向です。実例や実際の使い方が見えると納得しやすいでしょう。',
        strength: '細かな事実を確認し、アイデアを日常で使える形に落とし込める。',
        caution: 'これまでの経験を頼りにしすぎると、まだ試していない可能性を見落とすことも。',
        relationship: '抽象的な話では具体例を尋ねつつ、相手が目指す全体像も聞いてみましょう。',
        action: '慣れた作業について、今の方法以外のやり方を一つだけ考えてみる。',
      },
      {
        description:
          '全体のつながりや、これからの可能性に目が向きやすい傾向です。背景の意味や仕組みを知ると理解が広がりやすいでしょう。',
        strength: '離れた情報を結びつけ、別の見方や将来の案を見つけられる。',
        caution: '先の構想に意識が向くと、目の前の条件や実務の細部が抜けやすいことも。',
        relationship: '大きなアイデアには、具体例や最初の一歩も添えて伝えてみましょう。',
        action: '思いついた案を一つ選び、今日できる小さな実験に置き換えてみる。',
      },
    ],
  },
  TF: {
    name: '判断で重視すること',
    labels: ['思考 T', '感情 F'],
    poles: [
      {
        description:
          '根拠の一貫性や、条件を比較した結論を重視しやすい傾向です。考え方の筋道を整理することで判断しやすくなります。',
        strength: '論点や条件を整理し、判断の理由を分かりやすく示せる。',
        caution: '解決策を急ぐと、相手には気持ちを聞いてもらえなかったと映ることもあります。',
        relationship: '助言の前に「聞いてほしい？ 一緒に方法を考えたい？」と確認してみましょう。',
        action: '次の相談では、解決策を出す前に相手の気持ちを一度言葉にして確かめる。',
      },
      {
        description:
          '大切にしたい価値観や、関わる人への影響を重視しやすい傾向です。一人ひとりが納得できるかを丁寧に考えます。',
        strength: '人の思いや背景をくみ取り、納得しやすい着地点を探せる。',
        caution: '相手への配慮が続くと、自分の希望や必要な判断を後回しにすることもあります。',
        relationship: '相手への理解に加え、自分が必要としていることも具体的に伝えてみましょう。',
        action: '迷っている選択について、大切な気持ちと現実の条件を一つずつ書き出す。',
      },
    ],
  },
  JP: {
    name: '物事の進め方',
    labels: ['計画 J', '柔軟 P'],
    poles: [
      {
        description:
          '見通しや区切りを作ることで動きやすい傾向です。予定や役割が見えていると、落ち着いて力を使いやすいでしょう。',
        strength: '段取りや優先順位を整え、着実に区切りまで進められる。',
        caution: '予定通りを大切にするあまり、変更の利点に目を向けにくいこともあります。',
        relationship: '最初に決めておきたいことと、途中で変えてよいことを分けて共有しましょう。',
        action: '次の予定に少し余白を入れ、変更が起きても困らない部分を一つ作る。',
      },
      {
        description:
          '状況に合わせて選び直せる余地があると動きやすい傾向です。試しながら方法を探す場で持ち味を発揮しやすいでしょう。',
        strength: '変化に合わせて方法を調整し、その場で使える選択肢を見つけられる。',
        caution: '選択肢を残し続けると、締め切りや周囲の準備に影響することもあります。',
        relationship: '自由に進めたい場合も、確認する時点と最低限の期限は共有してみましょう。',
        action: '今の作業に短い確認時刻を一つ決め、その時点で進み具合を見直す。',
      },
    ],
  },
  AT: {
    name: '自分とプレッシャーへの向き合い方',
    labels: ['安定 A', '敏感 T'],
    poles: [
      {
        description:
          '評価や失敗で気持ちが揺れても、自分のペースへ戻りやすい回答傾向です。慎重さや改善意欲の有無を示すものではありません。',
        strength: '自分への信頼を保ち、うまくいかない場面でも次の行動へ切り替えやすい。',
        caution: '落ち着いていられる一方で、周囲の小さな懸念を見過ごすこともあります。',
        relationship: '自分には平気な場面でも、相手が気にしている点を尋ねてみましょう。',
        action: '最近の取り組みについて、続けたい点と見直せる点を一つずつ挙げる。',
      },
      {
        description:
          '周囲の評価や先の見通しを丁寧に気にかけやすい回答傾向です。その時々の疲れや状況でも変わり得ます。',
        strength: '小さな変化や改善の余地に気づき、準備を丁寧に進めやすい。',
        caution: '振り返りが続くと、自分に求める基準が高くなりすぎることもあります。',
        relationship: '気がかりは一人で推測し続けず、相手に具体的に確認してみましょう。',
        action: '振り返る時間を短く区切り、できたことも一つ書いてから休む。',
      },
    ],
  },
};

export function createMbtiReport(scores: MbtiScores) {
  const resultType = computeMbtiType(scores);
  const identity = computeMbtiIdentity(scores);
  const axes = MBTI_AXES.map((axis) => {
    const copy = AXIS_COPY[axis];
    const percent = computeMbtiAxisPercent(scores, axis);
    const balanced = Math.abs(percent - 50) <= 5;
    const side = scores[axis] >= 0 ? 0 : 1;
    return {
      axis,
      name: copy.name,
      labels: copy.labels,
      percent,
      balanced,
      tendency: balanced ? '両方の傾向が近い' : `${copy.labels[side]}寄り`,
      ...copy.poles[side],
      description: balanced
        ? `今回の回答では${copy.labels[0]}と${copy.labels[1]}が近い位置にあります。場面によって両方のやり方を使っている可能性があります。タイプの文字だけで決めつけず、どの場面で違いが出るか振り返ってみましょう。`
        : copy.poles[side].description,
    };
  });
  const sections = [
    { title: '活かしやすい強み', key: 'strength' as const },
    { title: '気をつけたい場面', key: 'caution' as const },
    { title: '人との関わり方', key: 'relationship' as const },
    { title: '日常で試せること', key: 'action' as const },
  ].map(({ title, key }) => ({
    title,
    items: axes.map((axis) => ({
      axis: axis.axis,
      text: axis.balanced
        ? {
            strength: `${axis.name}はどちらか一方に偏らない回答でした。場面ごとに合う方法を探せます。`,
            caution: `${axis.name}は境界に近いため、一方のタイプの説明を当てはめすぎないでください。`,
            relationship: `${axis.name}は相手や状況によって変わることを、具体的な場面と一緒に伝えてみましょう。`,
            action: `${axis.name}について、二つの傾向がそれぞれ出た最近の場面を書いてみる。`,
          }[key]
        : axis[key],
    })),
  }));
  return {
    resultType,
    identity,
    title: MBTI_TYPES[resultType]!.title,
    summary: MBTI_TYPES[resultType]!.description,
    identityLabel: MBTI_IDENTITY_INFO[identity].label,
    axes,
    sections,
    boundaryNote: axes.some((axis) => axis.balanced)
      ? '境界に近い軸があります。タイプの文字は便宜的な分類で、強い傾向を示すとは限りません。'
      : null,
    disclaimer:
      '独自の簡易性格診断です。割合は回答傾向の目安で、正確さの確率や能力の評価ではありません。',
  };
}

/** Public snapshots contain aggregate scores only; they are not authenticated completion proofs. */
export function mbtiShareSearch(scores: MbtiScores): string {
  const params = new URLSearchParams({ v: '1' });
  for (const axis of MBTI_AXES) params.set(axis.toLowerCase(), String(scores[axis]));
  return params.toString();
}

export function parseMbtiShareScores(params: URLSearchParams): MbtiScores | null {
  if (params.getAll('v').length !== 1 || params.get('v') !== '1') return null;
  const scores = {} as MbtiScores;
  for (const axis of MBTI_AXES) {
    const values = params.getAll(axis.toLowerCase());
    if (values.length !== 1 || !/^-?\d{1,2}$/.test(values[0]!)) return null;
    const value = Number(values[0]);
    if (Math.abs(value) > MBTI_AXIS_QUESTION_COUNTS[axis] * 2) return null;
    scores[axis] = value;
  }
  if (
    [...params.keys()].some(
      (key) => !['v', ...MBTI_AXES.map((axis) => axis.toLowerCase())].includes(key),
    )
  )
    return null;
  return scores;
}
