import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { MEMBER_ACTIVITY_EVENT_TYPES } from './activity-log-repository.js';
import {
  backfillChannelOverwriteEvents,
  buildChannelOverwriteRecordInput,
  diffPermissionOverwrites,
  MEMBER_ACTIVITY_EVENT_LABELS,
  normalizeActivityLogConfig,
  permissionOverwriteState,
  type ChannelOverwriteAuditEntryLike,
} from './activity-log.js';

describe('normalizeActivityLogConfig', () => {
  it('既定値はenabled:falseで記録対象は全てtrue', () => {
    expect(normalizeActivityLogConfig(undefined)).toEqual({
      enabled: false,
      trackVoice: true,
      trackMessages: true,
      trackEmoji: true,
      trackInvites: true,
      trackNicknameAvatar: true,
      trackMembership: true,
      trackUsernameChange: true,
      trackMemberRoles: true,
      trackRoleManagement: true,
      trackServerSettings: true,
      trackChannelManagement: true,
      trackModerationBans: true,
      trackTimeout: true,
      excludedChannelIds: [],
      excludedRoleIds: [],
      moderationAlertsEnabled: false,
      alertChannelId: null,
      messageBurstThreshold: 8,
      messageBurstWindowSeconds: 10,
      deleteBurstThreshold: 5,
      deleteBurstWindowSeconds: 30,
    });
  });

  it('enabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(normalizeActivityLogConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeActivityLogConfig({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeActivityLogConfig({}).enabled).toBe(false);
  });

  it('不正なIDは除外し、上限50件・重複排除する', () => {
    const config = normalizeActivityLogConfig({
      excludedChannelIds: ['123', '123', 'bad', ...Array.from({ length: 60 }, (_, i) => `${i}`)],
      excludedRoleIds: ['456', 'bad'],
    });
    expect(config.excludedChannelIds).toHaveLength(50);
    expect(config.excludedChannelIds).toContain('123');
    expect(config.excludedChannelIds).not.toContain('bad');
    expect(config.excludedRoleIds).toEqual(['456']);
  });

  it('記録対象トグルを個別にfalseへできる', () => {
    const config = normalizeActivityLogConfig({
      trackVoice: false,
      trackMessages: false,
      trackEmoji: false,
      trackInvites: false,
      trackNicknameAvatar: false,
      trackMembership: false,
      trackUsernameChange: false,
      trackMemberRoles: false,
      trackRoleManagement: false,
      trackServerSettings: false,
      trackChannelManagement: false,
      trackModerationBans: false,
      trackTimeout: false,
    });
    expect(config.trackVoice).toBe(false);
    expect(config.trackMessages).toBe(false);
    expect(config.trackEmoji).toBe(false);
    expect(config.trackInvites).toBe(false);
    expect(config.trackNicknameAvatar).toBe(false);
    expect(config.trackMembership).toBe(false);
    expect(config.trackUsernameChange).toBe(false);
    expect(config.trackMemberRoles).toBe(false);
    expect(config.trackRoleManagement).toBe(false);
    expect(config.trackServerSettings).toBe(false);
    expect(config.trackChannelManagement).toBe(false);
    expect(config.trackModerationBans).toBe(false);
    expect(config.trackTimeout).toBe(false);
  });

  it('moderationAlertsEnabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(
      normalizeActivityLogConfig({ moderationAlertsEnabled: true }).moderationAlertsEnabled,
    ).toBe(true);
    expect(normalizeActivityLogConfig({}).moderationAlertsEnabled).toBe(false);
  });

  it('alertChannelIdは数字のみ許可し、それ以外はnullになる', () => {
    expect(normalizeActivityLogConfig({ alertChannelId: '123456' }).alertChannelId).toBe('123456');
    expect(
      normalizeActivityLogConfig({ alertChannelId: 'not-a-channel' }).alertChannelId,
    ).toBeNull();
    expect(normalizeActivityLogConfig({ alertChannelId: null }).alertChannelId).toBeNull();
  });

  it('burstしきい値・時間幅は範囲外なら既定値へ、範囲内ならその値へclampする', () => {
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 1 }).messageBurstThreshold).toBe(3);
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 999 }).messageBurstThreshold).toBe(
      50,
    );
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 20 }).messageBurstThreshold).toBe(
      20,
    );
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 'bad' }).messageBurstThreshold).toBe(
      8,
    );
    expect(
      normalizeActivityLogConfig({ deleteBurstWindowSeconds: 1 }).deleteBurstWindowSeconds,
    ).toBe(5);
  });
});

describe('MEMBER_ACTIVITY_EVENT_LABELS', () => {
  it('全event typeに日本語ラベルを持ち、英語の生event値を表示に残さない', () => {
    for (const eventType of MEMBER_ACTIVITY_EVENT_TYPES) {
      const label = MEMBER_ACTIVITY_EVENT_LABELS[eventType];
      expect(label).toBeTruthy();
      expect(label).not.toBe(eventType);
    }
  });
});

const VIEW_CHANNEL = PermissionFlagsBits.ViewChannel;
const SEND_MESSAGES = PermissionFlagsBits.SendMessages;

function overwriteEntry(
  overrides: Partial<ChannelOverwriteAuditEntryLike> = {},
): ChannelOverwriteAuditEntryLike {
  return {
    id: 'audit-entry-1',
    action: AuditLogEvent.ChannelOverwriteUpdate,
    targetId: 'channel-1',
    executorId: 'executor-1',
    createdTimestamp: Date.parse('2026-11-27T03:55:00+09:00'),
    changes: [],
    overwriteId: 'guild-1',
    overwriteType: 'role',
    overwriteName: null,
    channelName: 'サポート窓口',
    ...overrides,
  };
}

describe('permissionOverwriteState / diffPermissionOverwrites', () => {
  it('allowビット優先で許可、denyビットで不許可、どちらも無ければ中間', () => {
    expect(permissionOverwriteState(VIEW_CHANNEL, 0n, VIEW_CHANNEL)).toBe('allow');
    expect(permissionOverwriteState(0n, VIEW_CHANNEL, VIEW_CHANNEL)).toBe('deny');
    expect(permissionOverwriteState(0n, 0n, VIEW_CHANNEL)).toBe('neutral');
  });

  it('変化した権限だけをキー付きで返す', () => {
    const changes = diffPermissionOverwrites({
      beforeAllow: VIEW_CHANNEL,
      beforeDeny: 0n,
      afterAllow: 0n,
      afterDeny: SEND_MESSAGES,
    });
    expect(changes).toEqual([
      { key: 'ViewChannel', before: 'allow', after: 'neutral' },
      { key: 'SendMessages', before: 'neutral', after: 'deny' },
    ]);
  });
});

describe('buildChannelOverwriteRecordInput', () => {
  it('update: 閲覧=許可→中間、送信=中間→不許可を3値で構造化する (スクショの権限変更行)', () => {
    const input = buildChannelOverwriteRecordInput(
      'guild-1',
      overwriteEntry({
        changes: [
          { key: 'allow', old: VIEW_CHANNEL.toString(), new: '0' },
          { key: 'deny', old: '0', new: SEND_MESSAGES.toString() },
        ],
      }),
    );

    expect(input).not.toBeNull();
    expect(input!.event).toBe('channel_overwrite_update');
    expect(input!.userId).toBe('executor-1');
    expect(input!.channelId).toBe('channel-1');
    expect(input!.occurredAt?.toISOString()).toBe('2026-11-26T18:55:00.000Z');
    expect(input!.metadata).toMatchObject({
      channelName: 'サポート窓口',
      auditLogEntryId: 'audit-entry-1',
      source: 'audit_log',
      actorResolved: true,
      // overwriteIdがギルドIDと同一なら@everyoneとして補完する
      overwrite: { id: 'guild-1', type: 'role', name: '@everyone' },
      permissions: [
        { key: 'ViewChannel', before: 'allow', after: 'neutral' },
        { key: 'SendMessages', before: 'neutral', after: 'deny' },
      ],
    });
  });

  it('create: beforeは全て中間として扱う', () => {
    const input = buildChannelOverwriteRecordInput(
      'guild-1',
      overwriteEntry({
        action: AuditLogEvent.ChannelOverwriteCreate,
        changes: [{ key: 'allow', new: VIEW_CHANNEL.toString() }],
      }),
    );
    expect(input!.event).toBe('channel_overwrite_create');
    expect(input!.metadata).toMatchObject({
      permissions: [{ key: 'ViewChannel', before: 'neutral', after: 'allow' }],
    });
  });

  it('delete: afterは全て中間として扱う', () => {
    const input = buildChannelOverwriteRecordInput(
      'guild-1',
      overwriteEntry({
        action: AuditLogEvent.ChannelOverwriteDelete,
        changes: [{ key: 'deny', old: SEND_MESSAGES.toString() }],
      }),
    );
    expect(input!.event).toBe('channel_overwrite_delete');
    expect(input!.metadata).toMatchObject({
      permissions: [{ key: 'SendMessages', before: 'deny', after: 'neutral' }],
    });
  });

  it('updateで片方のキーしか変化していない場合は欠けたキーを不変として扱う', () => {
    const input = buildChannelOverwriteRecordInput(
      'guild-1',
      overwriteEntry({
        changes: [{ key: 'deny', old: '0', new: SEND_MESSAGES.toString() }],
      }),
    );
    expect(input!.metadata).toMatchObject({
      permissions: [{ key: 'SendMessages', before: 'neutral', after: 'deny' }],
    });
  });

  it('実行者が取れない場合はuserId=null・actorResolved=falseで記録する (推測しない)', () => {
    const input = buildChannelOverwriteRecordInput('guild-1', overwriteEntry({ executorId: null }));
    expect(input!.userId).toBeNull();
    expect(input!.metadata).toMatchObject({ actorResolved: false });
  });

  it('overwrite以外のactionと対象チャンネル不明のエントリはnullを返す', () => {
    expect(
      buildChannelOverwriteRecordInput(
        'guild-1',
        overwriteEntry({ action: AuditLogEvent.ChannelUpdate }),
      ),
    ).toBeNull();
    expect(
      buildChannelOverwriteRecordInput('guild-1', overwriteEntry({ targetId: null })),
    ).toBeNull();
  });
});

describe('backfillChannelOverwriteEvents', () => {
  function mockBackfillPrisma(recordedEntryIds: Set<string>) {
    const create = vi.fn(
      async (args: {
        data: {
          event: string;
          metadata: { auditLogEntryId: string; overwrite: unknown };
        };
      }) => {
        recordedEntryIds.add(args.data.metadata.auditLogEntryId);
        return undefined;
      },
    );
    const findFirst = vi.fn(async (args: { where: { metadata: { equals: string } } }) =>
      recordedEntryIds.has(args.where.metadata.equals) ? { id: 'row-1' } : null,
    );
    const prisma = {
      memberActivityEvent: { create, findFirst },
    } as unknown as PrismaClient;
    return { prisma, create, findFirst };
  }

  function rawEntry(
    id: string,
    createdTimestamp: number,
    action: AuditLogEvent = AuditLogEvent.ChannelOverwriteUpdate,
  ) {
    return {
      id,
      action,
      targetId: 'channel-1',
      executorId: 'executor-1',
      createdTimestamp,
      changes: [{ key: 'deny', old: '0', new: SEND_MESSAGES.toString() }],
      extra: { id: 'guild-1', name: '@everyone', type: '0' },
      target: { name: 'サポート窓口' },
    };
  }

  function backfillContext(prisma: PrismaClient, config: Record<string, unknown>) {
    return {
      guildId: 'guild-1',
      config,
      prisma,
      logger: { warn: vi.fn() },
      client: null,
      manifest: {},
    } as unknown as Parameters<typeof backfillChannelOverwriteEvents>[0];
  }

  it('未記録分だけを記録し、再実行しても二重記録しない (冪等)', async () => {
    const recorded = new Set<string>(['entry-old']);
    const { prisma, create } = mockBackfillPrisma(recorded);
    const guild = {
      id: 'guild-1',
      fetchAuditLogs: vi.fn(async ({ type }: { type: AuditLogEvent }) => ({
        entries:
          type === AuditLogEvent.ChannelOverwriteUpdate
            ? new Map([
                ['entry-new', rawEntry('entry-new', 2000)],
                ['entry-old', rawEntry('entry-old', 1000)],
              ])
            : new Map(),
      })),
    };

    const context = backfillContext(prisma, { enabled: true });
    await expect(backfillChannelOverwriteEvents(context, guild)).resolves.toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data;
    expect(data.event).toBe('channel_overwrite_update');
    expect(data.metadata.auditLogEntryId).toBe('entry-new');
    expect(data.metadata.overwrite).toEqual({ id: 'guild-1', type: 'role', name: '@everyone' });

    await expect(backfillChannelOverwriteEvents(context, guild)).resolves.toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('プラグイン無効・trackChannelManagement=falseでは取得自体を行わない', async () => {
    const { prisma } = mockBackfillPrisma(new Set());
    const guild = { id: 'guild-1', fetchAuditLogs: vi.fn(async () => ({ entries: new Map() })) };

    await expect(
      backfillChannelOverwriteEvents(backfillContext(prisma, { enabled: false }), guild),
    ).resolves.toBe(0);
    await expect(
      backfillChannelOverwriteEvents(
        backfillContext(prisma, { enabled: true, trackChannelManagement: false }),
        guild,
      ),
    ).resolves.toBe(0);
    expect(guild.fetchAuditLogs).not.toHaveBeenCalled();
  });

  it('fetchAuditLogsが失敗した種別はスキップし、他種別の補完は継続する', async () => {
    const recorded = new Set<string>();
    const { prisma, create } = mockBackfillPrisma(recorded);
    const guild = {
      id: 'guild-1',
      fetchAuditLogs: vi.fn(async ({ type }: { type: AuditLogEvent }) => {
        if (type === AuditLogEvent.ChannelOverwriteCreate) throw new Error('403');
        return {
          entries:
            type === AuditLogEvent.ChannelOverwriteDelete
              ? new Map([
                  ['entry-del', rawEntry('entry-del', 1000, AuditLogEvent.ChannelOverwriteDelete)],
                ])
              : new Map(),
        };
      }),
    };

    await expect(
      backfillChannelOverwriteEvents(backfillContext(prisma, { enabled: true }), guild),
    ).resolves.toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
