import { readFileSync, writeFileSync } from 'node:fs';

function replaceOrThrow(path, before, after) {
  const current = readFileSync(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`${path}: expected source block was not found`);
  }
  writeFileSync(path, current.replace(before, after));
}

function updateJson(path, updater) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  updater(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

replaceOrThrow(
  'packages/db/prisma/schema.prisma',
  `model AutoResponse {
  id              String   @id @default(uuid())
  guildId         String   @map("guild_id")
  name            String
  triggerType     String   @map("trigger_type")
  triggerValue    String   @map("trigger_value")
  matchMode       String   @default("partial") @map("match_mode")
  responseType    String   @default("text") @map("response_type")
  responseContent String   @map("response_content")
  channelIds      String[] @map("channel_ids")
  roleIds         String[] @map("role_ids")
  cooldownSeconds Int      @default(0) @map("cooldown_seconds")
  enabled         Boolean  @default(true)
  createdBy       String?  @map("created_by")
  updatedBy       String?  @map("updated_by")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([guildId, enabled])
  @@map("auto_responses")
}`,
  `model AutoResponse {
  id              String    @id @default(uuid())
  guildId         String    @map("guild_id")
  name            String
  triggerType     String    @map("trigger_type")
  triggerValue    String    @map("trigger_value")
  matchMode       String    @default("partial") @map("match_mode")
  responseType    String    @default("text") @map("response_type")
  responseContent String    @map("response_content")
  channelIds      String[]  @map("channel_ids")
  roleIds         String[]  @map("role_ids")
  cooldownSeconds Int       @default(0) @map("cooldown_seconds")
  priority        Int       @default(0)
  caseSensitive   Boolean   @default(false) @map("case_sensitive")
  responseCount   Int       @default(0) @map("response_count")
  failureCount    Int       @default(0) @map("failure_count")
  lastTriggeredAt DateTime? @map("last_triggered_at") @db.Timestamptz(3)
  enabled         Boolean   @default(true)
  createdBy       String?   @map("created_by")
  updatedBy       String?   @map("updated_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  executionEvents AutoResponseExecutionEvent[]

  @@index([guildId, enabled])
  @@index([guildId, priority, createdAt])
  @@map("auto_responses")
}

model AutoResponseExecutionEvent {
  id         String   @id @default(uuid())
  guildId    String   @map("guild_id")
  ruleId     String   @map("rule_id")
  status     String
  durationMs Int      @map("duration_ms")
  errorName  String?  @map("error_name")
  executedAt DateTime @default(now()) @map("executed_at") @db.Timestamptz(3)

  rule AutoResponse @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([guildId, executedAt(sort: Desc)])
  @@index([ruleId, executedAt(sort: Desc)])
  @@index([status, executedAt(sort: Desc)])
  @@map("auto_response_execution_events")
}`,
);

updateJson('plugins/auto-response/package.json', (pkg) => {
  pkg.exports['./runtime'] = {
    types: './src/plugin.ts',
    default: './dist/plugin.js',
  };
  pkg.exports['./service'] = {
    types: './src/service.ts',
    default: './dist/service.js',
  };
  pkg.exports['./config'] = {
    types: './src/config.ts',
    default: './dist/config.js',
  };
});

updateJson('packages/plugin-catalog/package.json', (pkg) => {
  pkg.exports['./auto-response-runtime'] = {
    types: './src/auto-response-runtime.ts',
    default: './dist/auto-response-runtime.js',
  };
  pkg.exports['./auto-response-service'] = {
    types: './src/auto-response-service.ts',
    default: './dist/auto-response-service.js',
  };
});

replaceOrThrow(
  'apps/bot/src/plugins/registry.ts',
  `import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import { moderationPlugin } from '@herta/plugin-catalog/moderation-runtime';`,
  `import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import { autoResponsePlugin } from '@herta/plugin-catalog/auto-response-runtime';
import { moderationPlugin } from '@herta/plugin-catalog/moderation-runtime';`,
);

replaceOrThrow(
  'apps/bot/src/plugins/registry.ts',
  `function createOfficialEntries(deps?: DefaultPluginRegistryDeps): RuntimePluginEntry[] {
  const moderationEntry = deps`,
  `function createOfficialEntries(deps?: DefaultPluginRegistryDeps): RuntimePluginEntry[] {
  const autoResponseEntry = deps
    ? toRuntimePluginEntry(
        autoResponsePlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof autoResponsePlugin.onEnable>>[0],
      )
    : undefined;
  const moderationEntry = deps`,
);

replaceOrThrow(
  'apps/bot/src/plugins/registry.ts',
  `    if (!getPluginManifest(pluginId)) return [];
    if (pluginId === 'moderation' && moderationEntry) return [moderationEntry];`,
  `    if (!getPluginManifest(pluginId)) return [];
    if (pluginId === 'auto-response' && autoResponseEntry) return [autoResponseEntry];
    if (pluginId === 'moderation' && moderationEntry) return [moderationEntry];`,
);

replaceOrThrow(
  'apps/bot/src/bot.ts',
  `function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'UnknownError';
}
`,
  `function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'UnknownError';
}

function messageContentIntentEnabled(): boolean {
  const value = process.env['DISCORD_ENABLE_MESSAGE_CONTENT_INTENT']?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function resolveGatewayIntents(logger: Logger): GatewayIntentBits[] {
  const intents = [GatewayIntentBits.Guilds];
  if (messageContentIntentEnabled()) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    logger.info('Auto Response用Message Content Intentを有効化します');
  } else {
    logger.warn(
      'DISCORD_ENABLE_MESSAGE_CONTENT_INTENTが無効なためメッセージ系Pluginは実行されません',
    );
  }
  return intents;
}
`,
);

replaceOrThrow(
  'apps/bot/src/bot.ts',
  `    this.client = new Client({
      // 現在のRuntimeはSlash Commandのみを扱うため、Privileged Intentは要求しない。
      intents: [GatewayIntentBits.Guilds],
    });`,
  `    this.client = new Client({
      intents: resolveGatewayIntents(this.logger),
    });`,
);

replaceOrThrow(
  'apps/bot/src/bot.ts',
  `    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });`,
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
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });`,
);

replaceOrThrow(
  '.env.example',
  `DISCORD_BOT_TOKEN=
# StudioのGuild Install導線で要求するBot権限bitfield。既定はSend Messagesのみ。`,
  `DISCORD_BOT_TOKEN=
# Auto Responseを使う場合だけtrue。Developer PortalのMessage Content Intentも有効化する。
DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false
# StudioのGuild Install導線で要求するBot権限bitfield。既定はSend Messagesのみ。`,
);

replaceOrThrow(
  '.env.production.example',
  `DISCORD_BOT_TOKEN=
# StudioのGuild Install導線で要求するBot権限bitfield。既定はSend Messagesのみ。`,
  `DISCORD_BOT_TOKEN=
# Auto Responseを本番で使う場合だけtrue。Developer Portal側のIntent有効化後に切り替える。
DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false
# StudioのGuild Install導線で要求するBot権限bitfield。既定はSend Messagesのみ。`,
);

replaceOrThrow(
  'docker-compose.prod.yml',
  `      DISCORD_BOT_TOKEN: \${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is required}
      DISCORD_GUILD_ID_DEV: \${DISCORD_GUILD_ID_DEV:-}`,
  `      DISCORD_BOT_TOKEN: \${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is required}
      DISCORD_ENABLE_MESSAGE_CONTENT_INTENT: \${DISCORD_ENABLE_MESSAGE_CONTENT_INTENT:-false}
      DISCORD_GUILD_ID_DEV: \${DISCORD_GUILD_ID_DEV:-}`,
);

replaceOrThrow(
  'apps/studio/src/app/dashboard/guilds/[guildId]/plugins/[pluginId]/page.tsx',
  `      {pluginId === 'quote' ? (
        <Link
          href={\`/dashboard/guilds/\${guildId}/plugins/quote/quotes\`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">Quote管理</h2>
            <p className="mt-1 text-sm text-muted">名言の検索・登録・編集・削除を行います。</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}`,
  `      {pluginId === 'quote' ? (
        <Link
          href={\`/dashboard/guilds/\${guildId}/plugins/quote/quotes\`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">Quote管理</h2>
            <p className="mt-1 text-sm text-muted">名言の検索・登録・編集・削除を行います。</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}

      {pluginId === 'auto-response' ? (
        <Link
          href={\`/dashboard/guilds/\${guildId}/auto-response\`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">Auto Responseルール管理</h2>
            <p className="mt-1 text-sm text-muted">トリガー、応答、Cooldown、対象範囲を管理します。</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}`,
);

replaceOrThrow(
  'apps/studio/src/lib/audit-logs.ts',
  `  'quote.delete': {
    label: 'Quoteを削除',
    summary: 'Quoteを削除しました。削除前の本文は監査画面には表示しません。',
  },
};`,
  `  'quote.delete': {
    label: 'Quoteを削除',
    summary: 'Quoteを削除しました。削除前の本文は監査画面には表示しません。',
  },
  'auto_response.create': {
    label: '自動応答ルールを作成',
    summary: 'Auto Responseルールを作成しました。トリガーと応答本文は表示しません。',
  },
  'auto_response.update': {
    label: '自動応答ルールを更新',
    summary: 'Auto Responseルールの設定を更新しました。本文は表示しません。',
  },
  'auto_response.enable': {
    label: '自動応答ルールを有効化',
    summary: 'Auto Responseルールを有効化しました。',
  },
  'auto_response.disable': {
    label: '自動応答ルールを無効化',
    summary: 'Auto Responseルールを無効化しました。',
  },
  'auto_response.delete': {
    label: '自動応答ルールを削除',
    summary: 'Auto Responseルールを削除しました。削除前の本文は表示しません。',
  },
};`,
);

console.log('Auto Response v1 foundation files updated.');
