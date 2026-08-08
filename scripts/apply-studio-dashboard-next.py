from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found: {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, count))


replace(
    "apps/bot/src/bot.ts",
    "import type { DiscordHealthObservation } from './health/types.js';",
    "import { loadGuildConfigurationOptions, type GuildConfigurationOptions } from './health/guild-options.js';\nimport type { DiscordHealthObservation } from './health/types.js';",
)
replace(
    "apps/bot/src/bot.ts",
    "  getDiscordHealthObservation(): DiscordHealthObservation {\n    return this.discordHealth.snapshot(this.client);\n  }",
    "  async getGuildConfigurationOptions(guildId: string): Promise<GuildConfigurationOptions | null> {\n    return loadGuildConfigurationOptions(this.client, guildId);\n  }\n\n  getDiscordHealthObservation(): DiscordHealthObservation {\n    return this.discordHealth.snapshot(this.client);\n  }",
)

replace(
    "apps/bot/src/health/server.ts",
    "import type { HertaHealthResponse, PublicServiceStatus } from './types.js';",
    "import type { GuildConfigurationOptions } from './guild-options.js';\nimport type { HertaHealthResponse, PublicServiceStatus } from './types.js';",
)
replace(
    "apps/bot/src/health/server.ts",
    "  getHealth: () => Promise<HertaHealthResponse>;\n  now?: () => Date;",
    "  getHealth: () => Promise<HertaHealthResponse>;\n  getGuildOptions?: (guildId: string) => Promise<GuildConfigurationOptions | null>;\n  now?: () => Date;",
)
replace(
    "apps/bot/src/health/server.ts",
    "    const pathname = new URL(url, 'http://localhost').pathname;\n    if (pathname !== '/healthz') {",
    """    const pathname = new URL(url, 'http://localhost').pathname;
    const guildOptionsMatch = /^\\/internal\\/guilds\\/(\\d+)\\/options$/u.exec(pathname);
    if (guildOptionsMatch) {
      if (method !== 'GET') {
        response.setHeader('Allow', 'GET');
        this.sendJson(response, 405, { status: 'method_not_allowed' });
        return;
      }
      if (!this.options.getGuildOptions) {
        this.sendJson(response, 404, { status: 'not_found' });
        return;
      }
      try {
        const options = await withTimeout(
          this.options.getGuildOptions(guildOptionsMatch[1]!),
          this.options.config.checkTimeoutMs + 1_000,
        );
        if (!options) {
          this.sendJson(response, 404, { status: 'guild_not_found' });
          return;
        }
        this.sendJson(response, 200, options);
      } catch {
        this.sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }
    if (pathname !== '/healthz') {""",
)

replace(
    "apps/bot/src/main.ts",
    "      getHealth: () => healthService.getHealth(),",
    "      getHealth: () => healthService.getHealth(),\n      getGuildOptions: (guildId) => bot.getGuildConfigurationOptions(guildId),",
)

replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    "import {\n  appendCustomRule,",
    "import { DiscordChannelPicker, DiscordRolePicker } from '@/components/discord-entity-picker';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport {\n  appendCustomRule,",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """export function ModerationConfigForm({
  guildId,
  initialEnabled,
  initialConfig,
}: {
  guildId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
}) {""",
    """export function ModerationConfigForm({
  guildId,
  initialEnabled,
  initialConfig,
  discordOptions,
}: {
  guildId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  discordOptions: GuildConfigurationOptions | null;
}) {""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    "          <BasicSection config={config} patchConfig={patchConfig} setConfig={setConfig} />",
    """          <BasicSection
            config={config}
            patchConfig={patchConfig}
            setConfig={setConfig}
            discordOptions={discordOptions}
          />""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    "          <ExemptionsSection config={config} patchConfig={patchConfig} />",
    """          <ExemptionsSection
            config={config}
            patchConfig={patchConfig}
            discordOptions={discordOptions}
          />""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """function BasicSection({
  config,
  patchConfig,
  setConfig,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
  setConfig: (config: ModerationConfigDraft) => void;
}) {""",
    """function BasicSection({
  config,
  patchConfig,
  setConfig,
  discordOptions,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
  setConfig: (config: ModerationConfigDraft) => void;
  discordOptions: GuildConfigurationOptions | null;
}) {""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """        <SettingCard
          title="ログ送信先チャンネルID"
          description="未指定ならDiscordへの追加ログ送信を行いません。"
        >
          <input
            value={config.logChannelId ?? ''}
            inputMode="numeric"
            placeholder="例: 123456789012345678"
            onChange={(event) => patchConfig({ logChannelId: event.target.value.trim() || null })}
            className={inputClassName}
          />
        </SettingCard>""",
    """        <SettingCard
          title="ログ送信先チャンネル"
          description="Discordサーバーから取得したチャンネルを名前またはIDで検索できます。"
        >
          <DiscordChannelPicker
            options={discordOptions?.channels ?? []}
            value={config.logChannelId}
            onChange={(value) => patchConfig({ logChannelId: typeof value === 'string' ? value : null })}
          />
        </SettingCard>""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """      <div className="mt-4">
        <IdListEditor
          title="実行を許可するモデレーターロールID"
          description="空の場合はDiscord権限だけで判定します。"
          values={config.allowedModeratorRoleIds}
          onChange={(values) => setConfig({ ...config, allowedModeratorRoleIds: values })}
        />
      </div>""",
    """      <div className="mt-4 rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-medium">実行を許可するモデレーターロール</p>
        <p className="mt-1 text-xs leading-5 text-muted">空の場合はDiscord権限だけで判定します。ロール名またはIDで検索できます。</p>
        <div className="mt-3">
          <DiscordRolePicker
            options={discordOptions?.roles ?? []}
            value={config.allowedModeratorRoleIds}
            multiple
            onChange={(value) =>
              setConfig({ ...config, allowedModeratorRoleIds: Array.isArray(value) ? value : [] })
            }
          />
        </div>
      </div>""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """function ExemptionsSection({
  config,
  patchConfig,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
}) {""",
    """function ExemptionsSection({
  config,
  patchConfig,
  discordOptions,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
  discordOptions: GuildConfigurationOptions | null;
}) {""",
)
replace(
    "apps/studio/src/components/moderation-config-form.tsx",
    """        <IdListEditor
          title="除外チャンネルID"
          description="Botコマンド用や管理者専用など、監視しないチャンネルを登録します。"
          values={config.autoExemptChannelIds}
          onChange={(values) => patchConfig({ autoExemptChannelIds: values })}
        />
        <IdListEditor
          title="除外ロールID"
          description="このロールを1つでも持つユーザーを自動検知から除外します。"
          values={config.autoExemptRoleIds}
          onChange={(values) => patchConfig({ autoExemptRoleIds: values })}
        />""",
    """        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-medium">除外チャンネル</p>
          <p className="mt-1 text-xs leading-5 text-muted">Botコマンド用や管理者専用など、監視しないチャンネルを選択します。</p>
          <div className="mt-3">
            <DiscordChannelPicker
              options={discordOptions?.channels ?? []}
              value={config.autoExemptChannelIds}
              multiple
              onChange={(value) =>
                patchConfig({ autoExemptChannelIds: Array.isArray(value) ? value : [] })
              }
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-medium">除外ロール</p>
          <p className="mt-1 text-xs leading-5 text-muted">このロールを1つでも持つユーザーを自動検知から除外します。</p>
          <div className="mt-3">
            <DiscordRolePicker
              options={discordOptions?.roles ?? []}
              value={config.autoExemptRoleIds}
              multiple
              onChange={(value) =>
                patchConfig({ autoExemptRoleIds: Array.isArray(value) ? value : [] })
              }
            />
          </div>
        </div>""",
)

replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    "import { AlertTriangle, BellRing, Save, ShieldAlert, ShieldCheck } from 'lucide-react';",
    "import { AlertTriangle, BellRing, Save, ShieldAlert, ShieldCheck } from 'lucide-react';\nimport { DiscordChannelPicker, DiscordRolePicker } from '@/components/discord-entity-picker';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """export function ModerationEnforcementForm({
  guildId,
  initialConfig,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
}) {""",
    """export function ModerationEnforcementForm({
  guildId,
  initialConfig,
  discordOptions,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
  discordOptions: GuildConfigurationOptions | null;
}) {""",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />""",
    """      <PermissionDiagnostics options={discordOptions} />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />""",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """          <Field label="通知チャンネルID" hint="未設定なら緊急Alertは送信しません。">
            <input
              value={config.autoAlertChannelId ?? ''}
              onChange={(event) => patch({ autoAlertChannelId: numericOrNull(event.target.value) })}
              inputMode="numeric"
              placeholder="123456789012345678"
              className={inputClassName}
            />
          </Field>""",
    """          <Field label="通知チャンネル" hint="未設定なら緊急Alertは送信しません。名前またはIDで検索できます。">
            <DiscordChannelPicker
              options={discordOptions?.channels ?? []}
              value={config.autoAlertChannelId}
              onChange={(value) => patch({ autoAlertChannelId: typeof value === 'string' ? value : null })}
            />
          </Field>""",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """          <Field
            label="メンションするRole ID"
            hint="カンマまたは改行区切り。@everyone/@hereは使用しません。"
          >
            <textarea
              value={config.autoAlertMentionRoleIds.join('\n')}
              onChange={(event) =>
                patch({ autoAlertMentionRoleIds: parseIdList(event.target.value) })
              }
              rows={3}
              className={inputClassName}
              placeholder={'111111111111111111\n222222222222222222'}
            />
          </Field>""",
    """          <Field
            label="メンションするRole"
            hint="Discordサーバーから取得したRoleを複数選択できます。@everyone/@hereは使用しません。"
          >
            <DiscordRolePicker
              options={discordOptions?.roles ?? []}
              value={config.autoAlertMentionRoleIds}
              multiple
              onChange={(value) =>
                patch({ autoAlertMentionRoleIds: Array.isArray(value) ? value : [] })
              }
            />
          </Field>""",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    "              updatePolicy={updatePolicy}\n            />",
    "              updatePolicy={updatePolicy}\n              discordOptions={discordOptions}\n            />",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """function PolicyCard({
  rule,
  config,
  updatePolicy,
}: {
  rule: RuleDescriptor;
  config: ModerationConfigDraft;
  updatePolicy: (selector: string, patch: Parameters<typeof setEnforcementPolicy>[2]) => void;
}) {""",
    """function PolicyCard({
  rule,
  config,
  updatePolicy,
  discordOptions,
}: {
  rule: RuleDescriptor;
  config: ModerationConfigDraft;
  updatePolicy: (selector: string, patch: Parameters<typeof setEnforcementPolicy>[2]) => void;
  discordOptions: GuildConfigurationOptions | null;
}) {""",
)
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    """          <Field label="付与するRole ID" hint="Botの最高ロールより下のRoleだけ指定できます。">
            <input
              value={policy.roleId ?? ''}
              onChange={(event) =>
                updatePolicy(rule.selector, { roleId: numericOrNull(event.target.value) })
              }
              inputMode="numeric"
              placeholder="123456789012345678"
              className={inputClassName}
            />
          </Field>""",
    """          <Field label="付与するRole" hint="Botの最高ロールより下で、Botが編集できるRoleだけ選択できます。">
            <DiscordRolePicker
              options={discordOptions?.roles ?? []}
              value={policy.roleId}
              editableOnly
              onChange={(value) =>
                updatePolicy(rule.selector, { roleId: typeof value === 'string' ? value : null })
              }
            />
          </Field>""",
)

diagnostic_marker = "function buildRuleDescriptors(config: ModerationConfigDraft): RuleDescriptor[] {"
diagnostic = """function PermissionDiagnostics({ options }: { options: GuildConfigurationOptions | null }) {
  if (!options) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm sm:p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">Botの実効権限を取得できません</p>
            <p className="mt-1 leading-6 text-muted">BotがGuildへ接続済みか確認してください。権限診断が取得できない間も設定保存はできます。</p>
          </div>
        </div>
      </section>
    );
  }

  const checks = [
    ['メッセージ削除', options.bot.manageMessages],
    ['Role管理', options.bot.manageRoles],
    ['Timeout', options.bot.moderateMembers],
    ['Kick', options.bot.kickMembers],
    ['BAN', options.bot.banMembers],
  ] as const;
  const missing = checks.filter(([, ok]) => !ok);

  return (
    <section className={`rounded-2xl border p-5 sm:p-6 ${missing.length ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Bot実効権限チェック</h2>
          <p className="mt-1 text-xs leading-5 text-muted">Discord Guildから現在のHerta Bot権限を直接取得しています。</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${missing.length ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
          {missing.length ? `${missing.length}項目を確認` : '必要権限 OK'}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {checks.map(([label, ok]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-border bg-background/70 px-3 py-2 text-xs">
            <span>{label}</span>
            <span className={ok ? 'text-emerald-400' : 'font-semibold text-amber-300'}>{ok ? 'OK' : '不足'}</span>
          </div>
        ))}
      </div>
      {!options.bot.manageMessages ? (
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-background/60 px-3 py-2 text-xs leading-5 text-amber-200">
          「メッセージ削除」が不足しているため、危険度に関係なくAction=削除 / 警告+削除は実行できません。StudioのBot再認可でManage Messagesを反映してください。
        </p>
      ) : null}
    </section>
  );
}

"""
replace(
    "apps/studio/src/components/moderation-enforcement-form.tsx",
    diagnostic_marker,
    diagnostic + diagnostic_marker,
)

replace(
    "plugins/moderation/src/automatic-runtime.ts",
    "async function executeAutomaticDiscordAction(\n",
    "export async function executeAutomaticDiscordAction(\n",
)
replace(
    "plugins/moderation/src/automatic-runtime.ts",
    "    await executeAutomaticDiscordAction(message, selected.policy, reason);",
    """    await executeAutomaticDiscordAction(message, selected.policy, reason);
    context.logger.info(
      {
        guildId: context.guildId,
        messageId: message.id,
        targetUserId: message.author.id,
        action,
        selector: selected.policy.selector,
        severity: selected.policy.severity,
      },
      '自動Moderation Discord操作を実行しました',
    );""",
)

Path("plugins/moderation/src/automatic-runtime.test.ts").write_text(
    """import { describe, expect, it, vi } from 'vitest';
import { executeAutomaticDiscordAction } from './automatic-runtime.js';
import type { AutomaticEnforcementPolicy } from './enforcement-config.js';

const BASE_POLICY: AutomaticEnforcementPolicy = {
  selector: 'invite_link',
  action: 'delete',
  severity: 'medium',
  timeoutMinutes: 10,
  roleId: null,
  warningMessage: null,
  banDeleteMessageSeconds: 0,
};

describe('automatic moderation Discord action', () => {
  it('危険度mediumかつAction=deleteで検知メッセージを削除する', async () => {
    const deleteMessage = vi.fn(async () => undefined);
    const message = {
      delete: deleteMessage,
      member: null,
      author: { send: vi.fn(async () => undefined) },
    };

    await executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason');
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  it('warn_deleteでは削除後に警告DMを送る', async () => {
    const calls: string[] = [];
    const message = {
      delete: vi.fn(async () => {
        calls.push('delete');
      }),
      member: null,
      author: {
        send: vi.fn(async () => {
          calls.push('warn');
        }),
      },
    };

    await executeAutomaticDiscordAction(
      message as never,
      { ...BASE_POLICY, action: 'warn_delete' },
      'test reason',
    );
    expect(calls).toEqual(['delete', 'warn']);
  });
});
"""
)
