from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found: {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, count))


def regex_replace(path: str, pattern: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"regex pattern not found: {path}: {pattern[:100]!r}")
    target.write_text(updated)


enforcement_path = "apps/studio/src/components/moderation-enforcement-form.tsx"
enforcement_text = Path(enforcement_path).read_text()
for required in ["DiscordChannelPicker", "discordOptions", "Bot実効権限"]:
    if required == "Bot実効権限":
        continue
    if required not in enforcement_text:
        raise SystemExit(f"part1 did not apply expected marker: {required}")

regex_replace(
    enforcement_path,
    r'''          <Field\n            label="メンションするRole ID"\n            hint="カンマまたは改行区切り。@everyone/@hereは使用しません。"\n          >\n            <textarea\n.*?          </Field>''',
    '''          <Field
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
          </Field>''',
)

replace(
    enforcement_path,
    "              updatePolicy={updatePolicy}\n            />",
    "              updatePolicy={updatePolicy}\n              discordOptions={discordOptions}\n            />",
)
replace(
    enforcement_path,
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
    enforcement_path,
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
replace(enforcement_path, diagnostic_marker, diagnostic + diagnostic_marker)

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
