import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const pending = new Map();

function read(path) {
  return pending.get(path) ?? readFileSync(path, 'utf8');
}

function set(path, content) {
  pending.set(path, content);
}

function replaceText(path, before, after, label) {
  const current = read(path);
  if (current.includes(after)) return;
  const count = current.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label} の一致数が ${count} 件です`);
  set(path, current.replace(before, after));
}

function replaceAllText(path, before, after, expectedCount, label) {
  const current = read(path);
  const count = current.split(before).length - 1;
  if (count === 0 && current.includes(after)) return;
  if (count !== expectedCount) {
    throw new Error(`${path}: ${label} の一致数が ${count}/${expectedCount} 件です`);
  }
  set(path, current.split(before).join(after));
}

function replaceRegex(path, pattern, replacement, marker, label) {
  const current = read(path);
  if (marker && current.includes(marker)) return;
  const matches = [...current.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`${path}: ${label} の一致数が ${matches.length} 件です`);
  }
  set(path, current.replace(pattern, replacement));
}

function create(path, content) {
  if (existsSync(path)) {
    if (read(path) === content) return;
    throw new Error(`${path}: 作成先が既に存在します`);
  }
  set(path, content);
}

replaceRegex(
  'apps/bot/src/bot.ts',
  /    this\.client\.on\(Events\.MessageCreate, async \(message\) => \{[\s\S]*?\n    \}\);\n\n    this\.client\.on\('error'/,
  `    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guildId) return;

      let events: Awaited<ReturnType<typeof this.pluginLoader.getGuildEvents>>;
      try {
        events = await this.pluginLoader.getGuildEvents(message.guildId);
      } catch (error) {
        this.logger.error(
          { err: error, guildId: message.guildId, channelId: message.channelId },
          'Guild Plugin Eventの取得に失敗しました',
        );
        return;
      }

      const handlers = events.filter((event) => event.event === Events.MessageCreate);
      for (const event of handlers) {
        try {
          await event.handler(message);
        } catch (error) {
          this.logger.error(
            {
              err: error,
              guildId: message.guildId,
              channelId: message.channelId,
              event: event.event,
            },
            'Plugin Event Handlerの実行に失敗しました',
          );
        }
      }
    });

    this.client.on('error'`,
  'Guild Plugin Eventの取得に失敗しました',
  'MessageCreate例外処理',
);

replaceText(
  'apps/bot/src/main.ts',
  'const EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;',
  `const EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const EXECUTION_ANALYTICS_RETENTION_DAYS = 90;`,
  '保持期間定数',
);
replaceText(
  'apps/bot/src/main.ts',
  `    const [commandDeleted, autoResponseDeleted] = await Promise.all([
      pruneCommandExecutionEvents(prisma),
      pruneAutoResponseExecutionEvents(prisma as unknown as AutoResponsePrismaClient),
    ]);`,
  `    const [commandDeleted, autoResponseDeleted] = await Promise.all([
      pruneCommandExecutionEvents(prisma, EXECUTION_ANALYTICS_RETENTION_DAYS),
      pruneAutoResponseExecutionEvents(
        prisma as unknown as AutoResponsePrismaClient,
        EXECUTION_ANALYTICS_RETENTION_DAYS,
      ),
    ]);`,
  '保持期間引数',
);
replaceAllText(
  'apps/bot/src/main.ts',
  'retentionDays: 90',
  'retentionDays: EXECUTION_ANALYTICS_RETENTION_DAYS',
  2,
  '保持期間ログ',
);

replaceText(
  'plugins/auto-response/src/config.ts',
  `export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
  `import { Script } from 'node:vm';

export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
  'node:vm import',
);
replaceText(
  'plugins/auto-response/src/config.ts',
  'const MAX_EMBED_FIELDS = 10;',
  `const MAX_EMBED_FIELDS = 10;
const REGEX_MATCH_SCRIPT = new Script('RegExp(pattern, flags).test(content)');`,
  'Regex Script',
);
replaceRegex(
  'plugins/auto-response/src/config.ts',
  /    case 'regex': \{[\s\S]*?\n      return matched;\n    \}/,
  `    case 'regex': {
      if (!config.regexEnabled) return false;
      assertSafeRegex(rule.triggerValue, config.regexMaxLength);
      try {
        return Boolean(
          REGEX_MATCH_SCRIPT.runInNewContext(
            {
              pattern: rule.triggerValue,
              flags: rule.caseSensitive ? 'u' : 'iu',
              content,
            },
            {
              timeout: config.regexExecutionBudgetMs,
              contextCodeGeneration: { strings: false, wasm: false },
            },
          ),
        );
      } catch (error) {
        if (isRegexExecutionTimeout(error)) {
          throw new AutoResponseValidationError('正規表現の評価時間が上限を超えました');
        }
        throw error;
      }
    }`,
  'REGEX_MATCH_SCRIPT.runInNewContext',
  'Regex実タイムアウト',
);
const wildcardGuard = `    /(?:\\.\\*|\\.\\+).*(?:\\.\\*|\\.\\+)/.test(pattern)`;
replaceText(
  'plugins/auto-response/src/config.ts',
  wildcardGuard,
  `    /\\((?:\\?:)?[^()]*\\|[^()]*\\)(?:\\*|\\+|\\{\\d+(?:,\\d*)?\\})/.test(pattern) ||
${wildcardGuard}`,
  '量指定付きalternation拒否',
);
replaceText(
  'plugins/auto-response/src/config.ts',
  `function normalizeTrigger(
  value: unknown,`,
  `function isRegexExecutionTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
  );
}

function normalizeTrigger(
  value: unknown,`,
  'Regex timeout判定',
);
replaceRegex(
  'plugins/auto-response/src/config.test.ts',
  /  it\('ネスト量指定・後方参照・複数wildcardを拒否する',[\s\S]*?\n  \}\);/,
  `  it('ネスト量指定・曖昧なalternation・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of [
      '(a+)+$',
      '(a)\\1',
      '.*foo.*bar.*',
      '(a|aa)+$',
      '(?:a|a)+$',
    ]) {
      expect(() => assertSafeRegex(pattern, 100)).toThrow(AutoResponseValidationError);
    }
  });`,
  '曖昧なalternation',
  'Regex拒否テスト',
);

replaceText(
  'plugins/auto-response/src/service.ts',
  'const EXECUTION_RETENTION_DAYS = 90;',
  'export const AUTO_RESPONSE_EXECUTION_RETENTION_DAYS = 90;',
  '保持期間定数export',
);
replaceRegex(
  'plugins/auto-response/src/service.ts',
  /(export async function updateAutoResponseRule[\s\S]*?return prisma\.\$transaction\(async \(tx\) => \{\n)(    const current =)/,
  `$1    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
$2`,
  "updateAutoResponseRule\n",
  '更新Guild lock',
);
replaceRegex(
  'plugins/auto-response/src/service.ts',
  /(export async function deleteAutoResponseRule[\s\S]*?return prisma\.\$transaction\(async \(tx\) => \{\n)(    const current =)/,
  `$1    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
$2`,
  "deleteAutoResponseRule\n",
  '削除Guild lock',
);
replaceRegex(
  'plugins/auto-response/src/service.ts',
  /export async function pruneAutoResponseExecutionEvents\(\n  prisma: AutoResponsePrismaClient,\n  now = new Date\(\),\n\): Promise<number> \{\n  const before = new Date\(now\.getTime\(\) - EXECUTION_RETENTION_DAYS \* 24 \* 60 \* 60 \* 1000\);/,
  `export async function pruneAutoResponseExecutionEvents(
  prisma: AutoResponsePrismaClient,
  retentionDays = AUTO_RESPONSE_EXECUTION_RETENTION_DAYS,
  now = new Date(),
): Promise<number> {
  const normalizedRetentionDays = Math.min(Math.max(Math.floor(retentionDays), 1), 3650);
  const before = new Date(now.getTime() - normalizedRetentionDays * 24 * 60 * 60 * 1000);`,
  'normalizedRetentionDays',
  '履歴削除引数',
);
replaceText(
  'plugins/auto-response/src/service.test.ts',
  `  listAutoResponseRules,
  type AutoResponsePrismaClient,`,
  `  listAutoResponseRules,
  updateAutoResponseRule,
  type AutoResponsePrismaClient,`,
  '更新テストimport',
);
replaceText(
  'plugins/auto-response/src/service.test.ts',
  `describe('Auto Response cooldown', () => {`,
  `describe('Auto Response mutation locking', () => {
  it('更新処理はGuild Advisory Lockを取得してからread/merge/writeする', async () => {
    const { client, tx } = mockClient();

    await updateAutoResponseRule(client, {
      guildId: GUILD_ID,
      ruleId: RULE_ID,
      actorId: USER_ID,
      source: 'dashboard',
      config: DEFAULT_AUTO_RESPONSE_CONFIG,
      patch: { name: 'Updated greeting' },
    });

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      GUILD_ID,
    );
  });
});

describe('Auto Response cooldown', () => {`,
  '更新競合テスト',
);

replaceRegex(
  'plugins/auto-response/src/plugin.ts',
  /    let claimed = false;[\s\S]*?      await message\.channel\.send\(buildResponse\(rule, config\)\);/,
  `    let response: AutoResponseSendOptions;
    try {
      assertBotCanRespond(message, rule.responseType);
      response = buildResponse(rule, config);
    } catch (error) {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'failure',
        durationMs: Date.now() - startedAt,
        errorName: errorName(error),
      });
      context.logger.warn(
        {
          err: error,
          guildId: context.guildId,
          channelId: message.channelId,
          ruleId: rule.id,
        },
        'Auto Responseの送信準備に失敗しました',
      );
      continue;
    }

    let claimed = false;
    try {
      claimed = await claimAutoResponseRule(context.prisma, {
        guildId: context.guildId,
        ruleId: rule.id,
        guildCooldownSeconds: config.guildCooldownSeconds,
      });
    } catch (error) {
      context.logger.error(
        { err: error, guildId: context.guildId, ruleId: rule.id },
        'Auto Response Cooldownの確保に失敗しました',
      );
      continue;
    }

    if (!claimed) {
      await safelyRecordExecution(context, {
        guildId: context.guildId,
        ruleId: rule.id,
        status: 'skipped',
        durationMs: Date.now() - startedAt,
        errorName: null,
      });
      continue;
    }

    try {
      await message.channel.send(response);`,
  'Auto Responseの送信準備に失敗しました',
  'Cooldown前送信準備',
);

replaceText(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `import { useState } from 'react';`,
  `import { useEffect, useState } from 'react';`,
  'useEffect import',
);
replaceText(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `interface RuleManagerProps {
  guildId: string;
  initialRules: AutoResponseRuleItem[];
}`,
  `interface RuleManagerProps {
  guildId: string;
  initialRules: AutoResponseRuleItem[];
  defaultRuleCooldownSeconds: number;
}`,
  '既定Cooldown prop',
);
replaceRegex(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  /const EMPTY_RULE: RuleDraft = \{[\s\S]*?\n\};/,
  `function createEmptyRule(defaultRuleCooldownSeconds: number): RuleDraft {
  return {
    name: '',
    triggerValue: '',
    matchMode: 'partial',
    responseType: 'text',
    responseContent: '',
    channelIds: '',
    roleIds: '',
    cooldownSeconds: defaultRuleCooldownSeconds,
    priority: 0,
    caseSensitive: false,
    enabled: true,
  };
}`,
  'function createEmptyRule',
  '新規ルール初期値',
);
replaceRegex(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  /export function AutoResponseRuleManager\(\{ guildId, initialRules \}: RuleManagerProps\) \{[\s\S]*?  const \[message, setMessage\] = useState<string \| null>\(null\);/,
  `export function AutoResponseRuleManager({
  guildId,
  initialRules,
  defaultRuleCooldownSeconds,
}: RuleManagerProps) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<RuleDraft>(() =>
    createEmptyRule(defaultRuleCooldownSeconds),
  );
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  useEffect(() => {
    setDraft(createEmptyRule(defaultRuleCooldownSeconds));
    setMessage(null);
  }, [guildId, defaultRuleCooldownSeconds]);`,
  'setRules(initialRules);',
  '一覧同期',
);
replaceText(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  '      setDraft(EMPTY_RULE);',
  '      setDraft(createEmptyRule(defaultRuleCooldownSeconds));',
  '作成後初期化',
);
replaceText(
  'apps/studio/src/app/dashboard/guilds/[guildId]/auto-response/page.tsx',
  '<AutoResponseRuleManager guildId={guildId} initialRules={items} />',
  `<AutoResponseRuleManager
            guildId={guildId}
            initialRules={items}
            defaultRuleCooldownSeconds={config.defaultRuleCooldownSeconds}
          />`,
  'Manager既定Cooldown',
);

replaceText(
  'packages/db/prisma/migrations/20260728163000_auto_response_plugin_v1/migration.sql',
  `CREATE INDEX "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
`,
  '',
  'index分離',
);
replaceText(
  'packages/db/prisma/migrations/20260728163000_auto_response_plugin_v1/migration.sql',
  `  CHECK ("match_mode" IN ('exact', 'partial', 'prefix', 'regex')),
  ADD CONSTRAINT "auto_responses_response_type_check"
  CHECK ("response_type" IN ('text', 'embed')),
  ADD CONSTRAINT "auto_responses_cooldown_seconds_check"
  CHECK ("cooldown_seconds" BETWEEN 0 AND 86400),
  ADD CONSTRAINT "auto_responses_priority_check"
  CHECK ("priority" BETWEEN -1000 AND 1000);`,
  `  CHECK ("match_mode" IN ('exact', 'partial', 'prefix', 'regex')) NOT VALID,
  ADD CONSTRAINT "auto_responses_response_type_check"
  CHECK ("response_type" IN ('text', 'embed')) NOT VALID,
  ADD CONSTRAINT "auto_responses_cooldown_seconds_check"
  CHECK ("cooldown_seconds" BETWEEN 0 AND 86400) NOT VALID,
  ADD CONSTRAINT "auto_responses_priority_check"
  CHECK ("priority" BETWEEN -1000 AND 1000) NOT VALID;`,
  'CHECK NOT VALID',
);
create(
  'packages/db/prisma/migrations/20260728163100_auto_response_priority_index_concurrently/migration.sql',
  `-- 既存auto_responsesへの書き込みを止めないため、このmigrationは単一SQL文を維持する。
CREATE INDEX CONCURRENTLY "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
`,
);

replaceText(
  'docs/plugins/AUTO_RESPONSE.md',
  '| `regexExecutionBudgetMs`     | `10`    | 評価時間の警戒値          |',
  '| `regexExecutionBudgetMs`     | `10`    | VM評価の強制タイムアウト  |',
  'Regex設定説明',
);
replaceText(
  'docs/plugins/AUTO_RESPONSE.md',
  `- 量指定子を含むgroupへの再量指定
- 複数の\`.*\`または\`.+\`を組み合わせるパターン
- 設定上限を超えるパターン
- 構文エラー

評価対象メッセージにも長さ上限を設定し、正規表現評価後に処理時間を確認します。ルール作成後も、処理時間と失敗数をStudioで監視してください。`,
  `- 量指定子を含むgroupへの再量指定
- alternationを含むgroupへの量指定
- 複数の\`.*\`または\`.+\`を組み合わせるパターン
- 設定上限を超えるパターン
- 構文エラー

評価対象メッセージにも長さ上限を設定します。実行時は\`node:vm\`の分離Contextで評価し、\`regexExecutionBudgetMs\`を超えた処理を強制停止します。タイムアウトは失敗メトリクスとして記録されるため、Studioで処理時間と失敗数を監視してください。`,
  'Regex安全境界',
);
replaceText(
  'docs/plugins/AUTO_RESPONSE.md',
  `  run --rm migrator

`,
  `  run --rm migrator

既存\`auto_responses\`への複合Indexは単一statementの\`CREATE INDEX CONCURRENTLY\` migrationで作成します。CHECK制約は本番反映時の全件scanを避けるため\`NOT VALID\`で追加し、低負荷時間帯に次を実行して検証状態へ移行します。

\`\`\`sql
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_match_mode_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_response_type_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_cooldown_seconds_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_priority_check";
\`\`\`

`,
  'migration運用補足',
);

for (const [path, content] of pending) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

console.log(`Applied ${pending.size} product file changes.`);
