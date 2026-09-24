export const AKINATOR_MAX_TURNS = 15;
const MAX_QUESTION_LENGTH = 200;
const MAX_GUESS_LENGTH = 100;

export const AKINATOR_ANSWERS = ['yes', 'no', 'probably', 'probably_not', 'unknown'] as const;
export type AkinatorAnswer = (typeof AKINATOR_ANSWERS)[number];

const ANSWER_LABELS: Record<AkinatorAnswer, string> = {
  yes: 'はい',
  no: 'いいえ',
  probably: 'たぶんそう',
  probably_not: 'たぶん違う',
  unknown: 'わからない',
};

export function isAkinatorAnswer(value: string): value is AkinatorAnswer {
  return (AKINATOR_ANSWERS as readonly string[]).includes(value);
}

export function akinatorAnswerLabel(answer: AkinatorAnswer): string {
  return ANSWER_LABELS[answer];
}

export interface AkinatorTurnRecord {
  question: string;
  answer: AkinatorAnswer;
}

export type AkinatorTurnResult =
  { type: 'question'; question: string } | { type: 'guess'; guess: string };

export function buildAkinatorPrompt(input: {
  history: readonly AkinatorTurnRecord[];
  excludedGuesses: readonly string[];
  turnNumber: number;
  maxTurns: number;
}): string {
  const lines: string[] = [
    'あなたは「アキネーター」のように、ユーザーが思い浮かべた実在または架空の人物・キャラクターを' +
      'Yes/No形式の質問で当てるゲームの進行役です。',
    '毎回、次のいずれか一方だけを出力してください。他の文章は一切書かないでください。',
    '- 次の質問をする場合: 1行目に "QUESTION: " に続けて質問文だけを書く。',
    '- 誰か特定できたと思う場合: 1行目に "GUESS: " に続けて人物・キャラクター名だけを書く。',
    `これまでの質問と回答 (${input.history.length}件):`,
  ];

  if (input.history.length === 0) {
    lines.push('(まだありません。最初の質問をしてください)');
  } else {
    input.history.forEach((turn, index) => {
      lines.push(`${index + 1}. Q: ${turn.question} / A: ${akinatorAnswerLabel(turn.answer)}`);
    });
  }

  if (input.excludedGuesses.length > 0) {
    lines.push(
      `以下は既に外れた推測です。同じ人物・キャラクターを再度推測しないでください: ${input.excludedGuesses.join(', ')}`,
    );
  }

  lines.push(`現在 ${input.turnNumber}/${input.maxTurns} ターン目です。`);
  if (input.turnNumber >= input.maxTurns) {
    lines.push('これが最終ターンです。必ず "GUESS: " で今できる最善の推測をしてください。');
  }

  return lines.join('\n');
}

export function parseAkinatorResponse(value: string): AkinatorTurnResult | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();

  const questionMatch = /^QUESTION:\s*(.+)$/is.exec(trimmed);
  if (questionMatch) {
    const question = questionMatch[1]!.split('\n')[0]!.trim();
    if (question.length < 1 || question.length > MAX_QUESTION_LENGTH) return null;
    return { type: 'question', question };
  }

  const guessMatch = /^GUESS:\s*(.+)$/is.exec(trimmed);
  if (guessMatch) {
    const guess = guessMatch[1]!.split('\n')[0]!.trim();
    if (guess.length < 1 || guess.length > MAX_GUESS_LENGTH) return null;
    return { type: 'guess', guess };
  }

  return null;
}
