import { readFileSync, writeFileSync } from 'node:fs';

function replaceOrThrow(path, before, after) {
  const current = readFileSync(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`${path}: expected source block was not found`);
  }
  writeFileSync(path, current.replace(before, after));
}

replaceOrThrow(
  'plugins/auto-response/src/config.ts',
  `export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
  `import { runInNewContext } from 'node:vm';

export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.ts',
  `    case 'regex': {
      if (!config.regexEnabled) return false;
      assertSafeRegex(rule.triggerValue, config.regexMaxLength);
      const startedAt = Date.now();
      const expression = new RegExp(rule.triggerValue, rule.caseSensitive ? 'u' : 'iu');
      const matched = expression.test(content);
      if (Date.now() - startedAt > config.regexExecutionBudgetMs) {
        throw new AutoResponseValidationError('正規表現の評価時間が上限を超えました');
      }
      return matched;
    }`,
  `    case 'regex': {
      if (!config.regexEnabled) return false;
      assertSafeRegex(rule.triggerValue, config.regexMaxLength);
      return evaluateRegexWithTimeout(
        rule.triggerValue,
        content,
        rule.caseSensitive,
        config.regexExecutionBudgetMs,
      );
    }`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.ts',
  `export function parseAutoResponseEmbed(value: string): AutoResponseEmbed {`,
  `export function evaluateRegexWithTimeout(
  pattern: string,
  input: string,
  caseSensitive: boolean,
  timeoutMs: number,
): boolean {
  try {
    const result = runInNewContext(
      'new RegExp(pattern, flags).test(input)',
      {
        pattern,
        flags: caseSensitive ? 'u' : 'iu',
        input,
      },
      {
        timeout: Math.max(1, Math.floor(timeoutMs)),
        contextCodeGeneration: { strings: false, wasm: false },
      },
    );
    return result === true;
  } catch (error) {
    if (isRegexTimeoutError(error)) {
      throw new AutoResponseValidationError('正規表現の評価時間が上限を超えました');
    }
    throw error;
  }
}

export function parseAutoResponseEmbed(value: string): AutoResponseEmbed {`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.ts',
  `    /\\[1-9]/.test(pattern) ||
    /\(\?(?:[=!]|<[=!]|>)/.test(pattern) ||
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)`,
  `    /\\[1-9]/.test(pattern) ||
    /\(\?(?:[=!]|<[=!]|>)/.test(pattern) ||
    /\([^)]*\|[^)]*\)(?:[?*+]|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.ts',
  `function normalizeTrigger(`,
  `function isRegexTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
  );
}

function normalizeTrigger(`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.test.ts',
  `  assertSafeRegex,
  matchesAutoResponse,`,
  `  assertSafeRegex,
  evaluateRegexWithTimeout,
  matchesAutoResponse,`,
);

replaceOrThrow(
  'plugins/auto-response/src/config.test.ts',
  `  it('ネスト量指定・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of ['(a+)+$', '(a)\\1', '.*foo.*bar.*']) {
      expect(() => assertSafeRegex(pattern, 100)).toThrow(AutoResponseValidationError);
    }
  });`,
  `  it('曖昧なオルタネーション・ネスト量指定・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of ['(a|aa)+$', '(a+)+$', '(a)\\1', '.*foo.*bar.*']) {
      expect(() => assertSafeRegex(pattern, 100)).toThrow(AutoResponseValidationError);
    }
  });

  it('VMの実タイムアウトで同期正規表現を中断する', () => {
    expect(() =>
      evaluateRegexWithTimeout('(a|aa)+$', \`\${'a'.repeat(32)}!\`, true, 10),
    ).toThrow('正規表現の評価時間が上限を超えました');
  });`,
);

replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  `- 量指定子を含むgroupへの再量指定
- 複数の\`.*\`または\`.+\`を組み合わせるパターン`,
  `- 曖昧なオルタネーションを含むgroupへの量指定（例: \`(a|aa)+\`）
- 量指定子を含むgroupへの再量指定
- 複数の\`.*\`または\`.+\`を組み合わせるパターン`,
);

replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  `評価対象メッセージにも長さ上限を設定し、正規表現評価後に処理時間を確認します。ルール作成後も、処理時間と失敗数をStudioで監視してください。`,
  `評価対象メッセージにも長さ上限を設定します。実行時はNode.js VMのタイムアウト付き隔離コンテキストで評価し、上限到達時は同期正規表現を中断して失敗メトリクスへ記録します。ルール作成後も、処理時間と失敗数をStudioで監視してください。`,
);

replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  `実行メトリクスに保存する情報:`,
  `実行メトリクスはBot起動時と24時間ごとに整理し、90日を超えた履歴を削除します。

実行メトリクスに保存する情報:`,
);

console.log('Auto Response review fixes applied.');
