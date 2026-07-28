import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const pending = new Map();

function read(path) {
  if (pending.has(path)) return pending.get(path);
  return readFileSync(path, 'utf8');
}

function replaceOnce(path, before, after, label) {
  const current = read(path);
  if (current.includes(after)) return;
  const first = current.indexOf(before);
  if (first < 0 || current.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: ${label} の置換元が一意に見つかりません`);
  }
  pending.set(path, `${current.slice(0, first)}${after}${current.slice(first + before.length)}`);
}

function replaceAll(path, before, after, expectedCount, label) {
  const current = read(path);
  const count = current.split(before).length - 1;
  if (count === 0 && current.includes(after)) return;
  if (count !== expectedCount) {
    throw new Error(`${path}: ${label} の件数が想定外です (${count}/${expectedCount})`);
  }
  pending.set(path, current.split(before).join(after));
}

function createFile(path, content) {
  if (existsSync(path)) {
    const current = read(path);
    if (current === content) return;
    throw new Error(`${path}: 作成先が既に存在し、内容が一致しません`);
  }
  pending.set(path, content);
}

replaceOnce(
  'apps/bot/src/bot.ts',
  `    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guildId) return;
      const events = await this.pluginLoader.getGuildEvents(message.guildId);
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
    });`,
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
    });`,
  'MessageCreate例外処理',
);

replaceOnce(
  'apps/bot/src/main.ts',
  `const EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;`,
  `const EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const EXECUTION_ANALYTICS_RETENTION_DAYS = 90;`,
  '保持期間定数',
);
replaceOnce(
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
replaceAll(
  'apps/bot/src/main.ts',
  'retentionDays: 90',
  'retentionDays: EXECUTION_ANALYTICS_RETENTION_DAYS',
  2,
  '保持期間ログ',
);

replaceOnce(
  'plugins/auto-response/src/config.ts',
  `export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
  `import { Script } from 'node:vm';

export type AutoResponseMatchMode = 'exact' | 'partial' | 'prefix' | 'regex';`,
  'node:vm import',
);
replaceOnce(
  'plugins/auto-response/src/config.ts',
  `const MAX_EMBED_FIELDS = 10;`,
  `const MAX_EMBED_FIELDS = 10;
const REGEX_MATCH_SCRIPT = new Script('RegExp(pattern, flags).test(content)');`,
  'Regex Script定義',
);
replaceOnce(
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
  'Regex実タイムアウト',
);
replaceOnce(
  'plugins/auto-response/src/config.ts',
  `    /\\[1-9]/.test(pattern) ||
    /\(\?(?:[=!]|<[=!]|>)/.test(pattern) ||
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)`,
  `    /\\[1-9]/.test(pattern) ||
    /\(\?(?:[=!]|<[=!]|>)/.test(pattern) ||
    /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /\((?:\?:)?[^()]*\|[^()]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(pattern) ||
    /(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)`,
  '量指定付きalternation拒否',
);
replaceOnce(
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
replaceOnce(
  'plugins/auto-response/src/config.test.ts',
  `  it('ネスト量指定・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of ['(a+)+$', '(a)\\1', '.*foo.*bar.*']) {
      expect(() => assertSafeRegex(pattern, 100)).toThrow(AutoResponseValidationError);
    }
  });`,
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
  'Regex拒否テスト',
);

replaceOnce(
  'plugins/auto-response/src/service.ts',
  `const EXECUTION_RETENTION_DAYS = 90;`,
  `export const AUTO_RESPONSE_EXECUTION_RETENTION_DAYS = 90;`,
  'Auto Response保持期間定数',
);
replaceOnce(
  'plugins/auto-response/src/service.ts',
  `  return prisma.$transaction(async (tx) => {
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;

    const normalized = normalizeAutoResponseRuleInput(`,
  `  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;

    const normalized = normalizeAutoResponseRuleInput(`,
  '更新処理のGuild lock',
);
replaceOnce(
  'plugins/auto-response/src/service.ts',
  `  return prisma.$transaction(async (tx) => {
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;
    await tx.auditLog.create({`,
  `  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
    const current = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId },
    });
    if (!current) return null;
    await tx.auditLog.create({`,
  '削除処理のGuild lock',
);
replaceOnce(
  'plugins/auto-response/src/service.ts',
  `export async function pruneAutoResponseExecutionEvents(
  prisma: AutoResponsePrismaClient,
  now = new Date(),
): Promise<number> {
  const before = new Date(now.getTime() - EXECUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000);`,
  `export async function pruneAutoResponseExecutionEvents(
  prisma: AutoResponsePrismaClient,
  retentionDays = AUTO_RESPONSE_EXECUTION_RETENTION_DAYS,
  now = new Date(),
): Promise<number> {
  const normalizedRetentionDays = Math.min(Math.max(Math.floor(retentionDays), 1), 3650);
  const before = new Date(now.getTime() - normalizedRetentionDays * 24 * 60 * 60 * 1000);`,
  '履歴削除の保持期間引数',
);
replaceOnce(
  'plugins/auto-response/src/service.test.ts',
  `  listAutoResponseRules,
  type AutoResponsePrismaClient,`,
  `  listAutoResponseRules,
  updateAutoResponseRule,
  type AutoResponsePrismaClient,`,
  '更新テストimport',
);
replaceOnce(
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

replaceOnce(
  'plugins/auto-response/src/plugin.ts',
  `    let claimed = false;
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
      assertBotCanRespond(message, rule.responseType);
      await message.channel.send(buildResponse(rule, config));`,
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
  'Cooldown確保前の送信準備',
);

replaceOnce(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `import { useState } from 'react';`,
  `import { useEffect, useState } from 'react';`,
  'useEffect import',
);
replaceOnce(
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
replaceOnce(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `const EMPTY_RULE: RuleDraft = {
  name: '',
  triggerValue: '',
  matchMode: 'partial',
  responseType: 'text',
  responseContent: '',
  channelIds: '',
  roleIds: '',
  cooldownSeconds: 5,
  priority: 0,
  caseSensitive: false,
  enabled: true,
};`,
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
  '新規ルール初期値',
);
replaceOnce(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `export function AutoResponseRuleManager({ guildId, initialRules }: RuleManagerProps) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);`,
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
  '一覧同期と既定Cooldown',
);
replaceOnce(
  'apps/studio/src/components/auto-response-rule-manager.tsx',
  `      setDraft(EMPTY_RULE);`,
  `      setDraft(createEmptyRule(defaultRuleCooldownSeconds));`,
  '作成後初期化',
);
replaceOnce(
  'apps/studio/src/app/dashboard/guilds/[guildId]/auto-response/page.tsx',
  `<AutoResponseRuleManager guildId={guildId} initialRules={items} />`,
  `<AutoResponseRuleManager
            guildId={guildId}
            initialRules={items}
            defaultRuleCooldownSeconds={config.defaultRuleCooldownSeconds}
          />`,
  'Manager既定Cooldown渡し',
);

replaceOnce(
  'packages/db/prisma/migrations/20260728163000_auto_response_plugin_v1/migration.sql',
  `CREATE INDEX "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
`,
  ``,
  '既存テーブルindex分離',
);
replaceOnce(
  'packages/db/prisma/migrations/20260728163000_auto_response_plugin_v1/migration.sql',
  `  ADD CONSTRAINT "auto_responses_match_mode_check"
  CHECK ("match_mode" IN ('exact', 'partial', 'prefix', 'regex')),
  ADD CONSTRAINT "auto_responses_response_type_check"
  CHECK ("response_type" IN ('text', 'embed')),
  ADD CONSTRAINT "auto_responses_cooldown_seconds_check"
  CHECK ("cooldown_seconds" BETWEEN 0 AND 86400),
  ADD CONSTRAINT "auto_responses_priority_check"
  CHECK ("priority" BETWEEN -1000 AND 1000);`,
  `  ADD CONSTRAINT "auto_responses_match_mode_check"
  CHECK ("match_mode" IN ('exact', 'partial', 'prefix', 'regex')) NOT VALID,
  ADD CONSTRAINT "auto_responses_response_type_check"
  CHECK ("response_type" IN ('text', 'embed')) NOT VALID,
  ADD CONSTRAINT "auto_responses_cooldown_seconds_check"
  CHECK ("cooldown_seconds" BETWEEN 0 AND 86400) NOT VALID,
  ADD CONSTRAINT "auto_responses_priority_check"
  CHECK ("priority" BETWEEN -1000 AND 1000) NOT VALID;`,
  'CHECK制約NOT VALID',
);
createFile(
  'packages/db/prisma/migrations/20260728163100_auto_response_priority_index_concurrently/migration.sql',
  `-- 既存auto_responsesへの書き込みを止めないため、このmigrationは単一SQL文を維持する。
CREATE INDEX CONCURRENTLY "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
`,
);

replaceOnce(
  'docs/plugins/AUTO_RESPONSE.md',
  `| \`regexExecutionBudgetMs\`     | \`10\`    | 評価時間の警戒値          |`,
  `| \`regexExecutionBudgetMs\`     | \`10\`    | VM評価の強制タイムアウト  |`,
  'Regex設定説明',
);
replaceOnce(
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
  'Regex安全境界説明',
);
replaceOnce(
  'docs/plugins/AUTO_RESPONSE.md',
  `docker compose \\
  --env-file .env.production \\
  -f docker-compose.prod.yml \\
  run --rm migrator

`,
  `docker compose \\
  --env-file .env.production \\
  -f docker-compose.prod.yml \\
  run --rm migrator

既存\`auto_responses\`への複合Indexは単一statementの\`CREATE INDEX CONCURRENTLY\` migrationで作成します。CHECK制約は本番反映時の全件scanを避けるため\`NOT VALID\`で追加し、低負荷時間帯に次を実行して検証状態へ移行します。

\`\`\`sql
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_match_mode_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_response_type_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_cooldown_seconds_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_priority_check";
\`\`\`

`,
  '本番migration補足',
);

for (const [path, content] of pending) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

console.log(`Applied ${pending.size} file changes.`);
