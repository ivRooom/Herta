import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  bar,
  buildMinecraftBotApiRequest,
  buildMinecraftControlSignature,
  canApproveMinecraftWhitelist,
  canControlMinecraftServer,
  buildMinecraftLinkStatusEmbed,
  buildMinecraftPendingRequestRows,
  buildMinecraftPendingRequestsEmbed,
  buildMinecraftRejectModal,
  buildMinecraftReviewNoticeEmbed,
  buildMinecraftWhitelistReminderEmbed,
  collectRecentlyRemindedRequestIds,
  formatMinecraftBotApiError,
  formatMinecraftLinkStatus,
  formatMinecraftPendingRequests,
  handleMinecraftWhitelistComponent,
  minecraftPendingElapsedHours,
  parseMinecraftPendingRequests,
  parseMinecraftWhitelistComponentId,
  rememberMinecraftWhitelistOperator,
  resolveMinecraftBotApiConfig,
  runMinecraftWhitelistReminderCycle,
  selectOverdueMinecraftRequests,
  minecraftControlImmediateMessage,
  minecraftControlPath,
  normalizeCpuPercent,
  buildMinecraftStatusCardModel,
  buildMinecraftStatusEmbed,
  buildMinecraftStatusImageEmbed,
  memberRoleIds,
  MINECRAFT_STATUS_CURRENT_URL_DEFAULT,
  MINECRAFT_STATUS_RUNTIME_URL_DEFAULT,
  MINECRAFT_WHITELIST_REMINDER_THRESHOLD_MS,
  normalizeMinecraftStatusConfig,
  buildReportAnnouncement,
  pickReportToAnnounce,
  reportAlreadyPosted,
  parseServerEvents,
  pickNewServerEvents,
  describeServerEvent,
  todayInTokyo,
  type MinecraftCurrentStatus,
  type MinecraftRuntimeStatus,
} from './minecraft-status.js';

const now = new Date('2026-11-10T01:00:00.000Z');

const current: MinecraftCurrentStatus = {
  status: 'online',
  collected_at: '2026-11-10T00:59:00.000Z',
  server: {
    name: 'IVRM Main',
    mode: 'Minecraft 26.1.2 / NeoForge / Main',
    connection: 'mc.ivrm.jp',
  },
  players: { online: 2, max: 10, names: ['ivurugg', 'kanata'] },
  uptime: { container: '12時間 36分' },
  resources: {
    docker_cpu: '1.09%',
    docker_memory: '2.821GiB / 10.64GiB',
    host_memory: '5.6Gi / 10Gi',
    load_average: '0.31, 0.34, 0.53',
  },
  versions: { minecraft: 'Minecraft 26.1.2 / NeoForge 26.1.2.87', java: 'openjdk 25' },
  runtime: { os: 'Oracle Linux Server 9.7', cpu_model: 'Neoverse-N1', cpu_cores: '2' },
  backup: {
    latest_local: {
      file: 'minecraft-main-20261110-030000.tar.gz',
      size: '937M',
      mtime: '2026-11-10 03:00:46',
    },
  },
};

const runtime: MinecraftRuntimeStatus = {
  generatedAt: '2026-11-10T00:59:00.000Z',
  status: 'partial_outage',
  players: { online: 2, max: 10 },
  servers: [
    { id: 'mc-main', containerState: 'running', health: 'healthy', runtimeStatus: 'running' },
    { id: 'ivrm-velocity', containerState: 'running', health: 'healthy', runtimeStatus: 'running' },
    {
      id: 'mc-resource',
      containerState: 'exited',
      health: 'unhealthy',
      runtimeStatus: 'sleeping',
      startability: 'startable',
      startable: true,
      autoScaleUp: true,
      reason: '休止中です。接続すると自動起動します',
    },
  ],
};

function field(embed: ReturnType<typeof buildMinecraftStatusEmbed>, name: string) {
  return embed?.fields?.find((item) => item.name === name);
}

describe('Minecraft Status v1', () => {
  it('設定値を安全な既定値と範囲へ正規化する', () => {
    expect(normalizeMinecraftStatusConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: false,
      showResources: true,
      showPerformanceGraph: true,
      showServers: true,
      showBackup: true,
      staleAfterMinutes: 3,
      announceReports: false,
      reportChannelId: '',
      announceEvents: false,
      eventChannelId: '',
      operatorRoleIds: [],
      whitelistApproverRoleIds: [],
      whitelistOpsChannelId: '',
    });
    expect(
      normalizeMinecraftStatusConfig({
        operatorRoleIds: ['123456789012345678', 'abc', '123456789012345678', 42],
      }),
    ).toMatchObject({ operatorRoleIds: ['123456789012345678'] });
    expect(normalizeMinecraftStatusConfig({ staleAfterMinutes: 999 })).toMatchObject({
      staleAfterMinutes: 60,
    });
    expect(normalizeMinecraftStatusConfig({ enabled: false })).toMatchObject({ enabled: false });
  });

  it('メンバーのロールIDを両形式から取り出す', () => {
    expect(memberRoleIds({ member: { roles: ['11111', '22222'] } })).toEqual(['11111', '22222']);
    expect(
      memberRoleIds({
        member: {
          roles: {
            cache: new Map([
              ['33333', {}],
              ['44444', {}],
            ]),
          },
        },
      }),
    ).toEqual(['33333', '44444']);
    expect(memberRoleIds({ member: null })).toEqual([]);
    expect(memberRoleIds({})).toEqual([]);
  });

  it('起動権限は必須ロールと設定ロールの和集合で判定する', () => {
    const config = normalizeMinecraftStatusConfig({ operatorRoleIds: ['999999999999999999'] });
    expect(canControlMinecraftServer({ member: { roles: ['1114417432346501130'] } }, config)).toBe(
      true,
    );
    expect(canControlMinecraftServer({ member: { roles: ['999999999999999999'] } }, config)).toBe(
      true,
    );
    expect(canControlMinecraftServer({ member: { roles: ['12345'] } }, config)).toBe(false);
    expect(canControlMinecraftServer({ member: null }, config)).toBe(false);
  });

  it('起動エンドポイント向け署名が固定ベクタと一致する', () => {
    expect(
      buildMinecraftControlSignature(
        'test-secret',
        'POST',
        '/v1/servers/mc-resource/start',
        '1760000000',
        '',
      ),
    ).toBe('04deb3b47ced43ec925d091c195ed41d2fed6d9ba0410a1841566b20364bcb0a');
  });

  it('操作パスと結果メッセージを組み立てる', () => {
    expect(minecraftControlPath('main', 'stop')).toBe('/v1/servers/main/stop');
    expect(minecraftControlPath('resource', 'regenerate')).toBe('/v1/servers/resource/regenerate');
    expect(
      minecraftControlImmediateMessage('resource', {
        kind: 'responded',
        status: 200,
        result: 'saved',
      }),
    ).toBe('資源サーバーをセーブしました。');
    expect(
      minecraftControlImmediateMessage('main', {
        kind: 'responded',
        status: 200,
        result: 'stopped',
      }),
    ).toBe('メインワールドをセーブして停止しました。');
    expect(
      minecraftControlImmediateMessage('main', {
        kind: 'responded',
        status: 200,
        result: 'not_running',
      }),
    ).toContain('セーブは行われませんでした');
    expect(
      minecraftControlImmediateMessage('resource', {
        kind: 'responded',
        status: 409,
        result: 'busy',
      }),
    ).toContain('他の操作が実行中です');
    expect(
      minecraftControlImmediateMessage('main', {
        kind: 'responded',
        status: 409,
        result: 'players_online',
        onlineCount: 3,
      }),
    ).toContain('現在3人');
    expect(
      minecraftControlImmediateMessage('main', {
        kind: 'responded',
        status: 409,
        result: 'players_online',
        onlineCount: 3,
      }),
    ).toContain('force オプション');
    expect(
      minecraftControlImmediateMessage('resource', {
        kind: 'responded',
        status: 409,
        result: 'players_unknown',
      }),
    ).toContain('確認できなかったため');
    expect(minecraftControlImmediateMessage('resource', { kind: 'unconfigured' })).toContain(
      '未設定です',
    );
    expect(
      minecraftControlImmediateMessage('resource', {
        kind: 'responded',
        status: 200,
        result: 'started',
      }),
    ).toBeNull();
    expect(
      minecraftControlImmediateMessage('resource', {
        kind: 'responded',
        status: 401,
        result: '',
      }),
    ).toContain('受け付けられませんでした');
  });

  it('CPU% はホスト全体を100%として正規化する', () => {
    expect(normalizeCpuPercent(114, 2)).toBe(57);
    expect(normalizeCpuPercent(250, 2)).toBe(100);
    expect(normalizeCpuPercent(30, 1)).toBe(30);
    expect(normalizeCpuPercent(30, 0)).toBe(30);
  });

  it('取得先は稼働中の status.ivrm.jp を既定値にする', () => {
    expect(MINECRAFT_STATUS_CURRENT_URL_DEFAULT).toBe('https://status.ivrm.jp/api/current.json');
    expect(MINECRAFT_STATUS_RUNTIME_URL_DEFAULT).toBe(
      'https://status.ivrm.jp/api/minecraft-runtime.json',
    );
  });

  it('割合を10セルのバーで表す', () => {
    expect(bar(0)).toBe('`░░░░░░░░░░`');
    expect(bar(0.5)).toBe('`█████░░░░░`');
    expect(bar(1)).toBe('`██████████`');
    expect(bar(2)).toBe('`██████████`');
  });

  it('Embedに稼働状態・プレイヤー・リソース・サーバー状態を表示する', () => {
    const embed = buildMinecraftStatusEmbed(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(embed?.title).toContain('IVRM Main — 🟢 オンライン');
    expect(embed?.url).toBe('https://status.ivrm.jp/');
    expect(embed?.description).toContain('IP: mc.ivrm.jp');
    expect(embed?.description).toContain('Minecraft 26.1.2 / NeoForge / Main');
    expect(field(embed, '👥 プレイヤー')?.value).toContain('**2 / 10**');
    expect(field(embed, '👥 プレイヤー')?.value).toContain('██░░░░░░░░');
    expect(field(embed, '🎮 オンライン')?.value).toBe('ivurugg, kanata');
    expect(field(embed, '⏱ 稼働時間')?.value).toBe('12時間 36分');
    const resources = field(embed, '📊 リソース')?.value ?? '';
    expect(resources).toContain('CPU');
    expect(resources).toContain('CPU `░░░░░░░░░░` 1%'); // 1.09% を2コアで正規化し四捨五入
    expect(resources).toContain('メモリ');
    expect(resources).toContain('27%');
    expect(resources).toContain('ホストメモリ');
    expect(resources).toContain('56%');
    expect(resources).toContain('Load `0.31, 0.34, 0.53`');
    expect(field(embed, '💾 最新バックアップ')?.value).toBe('2026-11-10 03:00:46（937M）');
    const servers = field(embed, '🖥 サーバー状態')?.value ?? '';
    expect(servers).toContain('🟢 **mc-main** — 稼働中（正常）');
    expect(servers).toContain('💤 **mc-resource** — 休止中（接続で自動起動）');
    expect(embed?.footer?.text).not.toContain('データが古い可能性があります');
  });

  it('停止中サーバーは起動可否で表示を変える', () => {
    const stoppedRuntime: MinecraftRuntimeStatus = {
      ...runtime,
      servers: [
        {
          id: 'mc-resource',
          containerState: 'exited',
          health: 'unhealthy',
          runtimeStatus: 'stopped',
          startability: 'unavailable',
          startable: false,
          reason: 'メモリ不足による停止を確認しました',
        },
        {
          id: 'mc-optional',
          containerState: 'exited',
          health: 'unhealthy',
          runtimeStatus: 'stopped',
          startability: 'startable',
          startable: true,
        },
      ],
    };
    const embed = buildMinecraftStatusEmbed(
      current,
      stoppedRuntime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    const servers = field(embed, '🖥 サーバー状態')?.value ?? '';
    expect(servers).toContain('🔴 **mc-resource** — 停止中（異常）');
    expect(servers).toContain('🟡 **mc-optional** — 停止中');
    const model = buildMinecraftStatusCardModel(
      current,
      stoppedRuntime,
      normalizeMinecraftStatusConfig(undefined),
    );
    expect(model?.servers?.map((s) => s.tone)).toEqual(['bad', 'warn']);
  });

  it('古いデータには stale 警告を付ける', () => {
    const staleCurrent = { ...current, collected_at: '2026-11-10T00:30:00.000Z' };
    const staleRuntime = { ...runtime, generatedAt: '2026-11-10T00:30:00.000Z' };
    const embed = buildMinecraftStatusEmbed(
      staleCurrent,
      staleRuntime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(embed?.footer?.text).toContain('データが古い可能性があります');
  });

  it('表示フラグOFFの項目を省略する', () => {
    const config = {
      ...normalizeMinecraftStatusConfig(undefined),
      showResources: false,
      showServers: false,
      showBackup: false,
    };
    const embed = buildMinecraftStatusEmbed(current, runtime, config, now);
    expect(field(embed, '📊 リソース')).toBeUndefined();
    expect(field(embed, '🖥 サーバー状態')).toBeUndefined();
    expect(field(embed, '💾 最新バックアップ')).toBeUndefined();
  });

  it('片方のデータだけでも表示し、両方欠けたら null を返す', () => {
    const onlyRuntime = buildMinecraftStatusEmbed(
      null,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(onlyRuntime?.title).toContain('🟢 オンライン');
    expect(field(onlyRuntime, '👥 プレイヤー')?.value).toContain('**2 / 10**');

    const none = buildMinecraftStatusEmbed(
      null,
      null,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(none).toBeNull();
  });

  it('画像カード用のモデルを組み立てる', () => {
    const model = buildMinecraftStatusCardModel(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
    );
    expect(model?.serverName).toBe('IVRM Main');
    expect(model?.statusText).toBe('オンライン');
    expect(model?.statusTone).toBe('online');
    expect(model?.players).toMatchObject({ online: 2, max: 10, ratio: 0.2 });
    expect(model?.players?.namesLine).toBe('ivurugg, kanata');
    expect(model?.resources).toMatchObject({
      cpuPercent: 0.545,
      memoryPercent: 27,
      hostMemoryPercent: 56,
    });
    expect(model?.servers?.map((s) => s.tone)).toEqual(['ok', 'ok', 'sleep']);
    expect(model?.hostLabel).toBe('Oracle Cloud · Oracle Linux 9.7 · Neoverse-N1 · 2コア');
    expect(model?.backupLabel).toBe('11/10 03:00（937M）');
    expect(
      buildMinecraftStatusCardModel(null, null, normalizeMinecraftStatusConfig(undefined)),
    ).toBeNull();
  });

  it('履歴があればパフォーマンスグラフ用の系列を組み立てる', () => {
    const base = 1_700_000_000;
    const history = {
      tiers: {
        '10s': {
          series: {
            'mc-main': [
              [base, 10, 27],
              [base + 10, 20, 27.5],
              [base + 20, null, 28],
            ] as [number, number | null, number | null][],
            'mc-resource': [
              [base, null, null],
              [base + 10, null, null],
            ] as [number, number | null, number | null][],
            host: [
              [base, 30, 55],
              [base + 10, 40, 56],
            ] as [number, number | null, number | null][],
          },
        },
      },
    };
    const model = buildMinecraftStatusCardModel(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      history,
    );
    // 資源は全て null なので系列に入らない。生活CPUは null を保持して途切れを表す
    expect(model?.performance?.cpu.map((s) => s.label)).toEqual(['生活', 'ホスト']);
    expect(model?.performance?.cpu[0]?.points).toEqual([10, 20, null]);
    expect(model?.performance?.memory.map((s) => s.label)).toEqual(['生活', 'ホスト']);
    // 設定で無効化したら履歴があっても付けない
    const disabled = buildMinecraftStatusCardModel(
      current,
      runtime,
      normalizeMinecraftStatusConfig({ showPerformanceGraph: false }),
      history,
    );
    expect(disabled?.performance).toBeUndefined();
    // 履歴が無い・空なら付けない
    expect(
      buildMinecraftStatusCardModel(
        current,
        runtime,
        normalizeMinecraftStatusConfig(undefined),
        null,
      )?.performance,
    ).toBeUndefined();
    expect(
      buildMinecraftStatusCardModel(current, runtime, normalizeMinecraftStatusConfig(undefined), {
        tiers: {},
      })?.performance,
    ).toBeUndefined();
  });

  it('画像Embedは attachment を指す', () => {
    const embed = buildMinecraftStatusImageEmbed(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(embed?.image?.url).toBe('attachment://herta-minecraft-status.png');
    expect(embed?.title).toContain('IVRM Main');
  });

  it('本文に状態文・IP・稼働状況リンクを含む', () => {
    const embed = buildMinecraftStatusImageEmbed(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(embed?.description).toContain('正常稼働中です。');
    expect(embed?.description).toContain('IP: mc.ivrm.jp');
    expect(embed?.description).toContain('稼働状況: https://status.ivrm.jp/');

    const fieldsEmbed = buildMinecraftStatusEmbed(
      current,
      runtime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(fieldsEmbed?.description).toContain('正常稼働中です。');
    expect(fieldsEmbed?.description).toContain('稼働状況: https://status.ivrm.jp/');

    const healthyRuntime: MinecraftRuntimeStatus = {
      ...runtime,
      status: 'operational',
      servers: runtime.servers?.map((s) => ({
        ...s,
        containerState: 'running',
        health: 'healthy',
        runtimeStatus: 'running',
      })),
    };
    const healthy = buildMinecraftStatusImageEmbed(
      current,
      healthyRuntime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(healthy?.description).toContain('正常稼働中です。');
  });

  it('オフライン状態を表示する', () => {
    const offline: MinecraftCurrentStatus = {
      status: 'offline',
      collected_at: '2026-11-10T00:59:00.000Z',
    };
    const embed = buildMinecraftStatusEmbed(
      offline,
      null,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(embed?.title).toContain('🔴 オフライン');
    expect(embed?.color).toBe(0xed4245);
  });
});

describe('サーバーイベント通知', () => {
  it('parses and sorts events, dropping invalid entries', () => {
    const events = parseServerEvents({
      events: [
        { seq: 3, at: '2026-11-11T19:00:37+09:00', server: 'resource', action: 'die', exitCode: 0 },
        { seq: 1, at: '2026-11-11T18:58:53+09:00', server: 'resource', action: 'start' },
        { seq: 2, server: 'other', action: 'start' },
        { seq: 0, server: 'main', action: 'start' },
        { seq: 4, server: 'main', action: 'explode' },
      ],
    });
    expect(events.map((event) => event.seq)).toEqual([1, 3]);
    expect(parseServerEvents(null)).toEqual([]);
    expect(parseServerEvents({})).toEqual([]);
    // 不正な日時は埋め込みを拒否させるため空に落とす
    expect(
      parseServerEvents({
        events: [{ seq: 5, at: 'not-a-date', server: 'main', action: 'start' }],
      })[0]?.at,
    ).toBe('');
  });

  it('picks only events newer than the cursor', () => {
    const events = parseServerEvents({
      events: [
        { seq: 1, server: 'main', action: 'start' },
        { seq: 2, server: 'main', action: 'die', exitCode: 0 },
        { seq: 3, server: 'resource', action: 'start' },
      ],
    });
    expect(pickNewServerEvents(events, 1).map((event) => event.seq)).toEqual([2, 3]);
    expect(pickNewServerEvents(events, 3)).toEqual([]);
  });

  it('describes start, clean stop, crash and oom distinctly', () => {
    expect(
      describeServerEvent({ seq: 1, at: '', server: 'main', action: 'start' }).title,
    ).toContain('生活サーバーが起動しました');
    const clean = describeServerEvent({
      seq: 2,
      at: '',
      server: 'resource',
      action: 'die',
      exitCode: 0,
    });
    expect(clean.title).toContain('資源サーバーが停止しました');
    const crash = describeServerEvent({
      seq: 3,
      at: '',
      server: 'main',
      action: 'die',
      exitCode: 137,
    });
    expect(crash.title).toContain('異常終了');
    expect(crash.description).toContain('137');
    expect(crash.color).not.toBe(clean.color);
    expect(describeServerEvent({ seq: 4, at: '', server: 'main', action: 'oom' }).title).toContain(
      'メモリ不足',
    );
  });
});

describe('日次レポート通知', () => {
  const entries = [
    { date: '2026-11-11', url: 'https://status.ivrm.jp/reports/2026-11-11.html' },
    { date: '2026-11-10', url: 'https://status.ivrm.jp/reports/2026-11-10.html' },
    { date: '2026-11-09', url: 'https://status.ivrm.jp/reports/2026-11-09.html' },
  ];

  it('当日の部分レポートは通知せず、前日の最新を選ぶ', () => {
    expect(pickReportToAnnounce(entries, '2026-11-11')?.date).toBe('2026-11-10');
    expect(pickReportToAnnounce(entries, '2026-11-09')).toBeNull();
    expect(pickReportToAnnounce([], '2026-11-11')).toBeNull();
  });

  it('チャンネル履歴に同じ URL があれば投稿済みとみなす', () => {
    const url = 'https://status.ivrm.jp/reports/2026-11-10.html';
    expect(reportAlreadyPosted([{ content: `see ${url}` }], url)).toBe(true);
    expect(reportAlreadyPosted([{ embeds: [{ url }] }], url)).toBe(true);
    expect(reportAlreadyPosted([{ content: 'unrelated' }], url)).toBe(false);
    // discord.js の Collection は values() で反復する形もカバーする
    const collection = new Map([
      ['1', { content: 'hello' }],
      ['2', { embeds: [{ url }] }],
    ]);
    expect(reportAlreadyPosted(collection.values(), url)).toBe(true);
  });

  it('通知 Embed にハイライトとリンクが入る', () => {
    const embed = buildReportAnnouncement({
      date: '2026-11-10',
      url: 'https://status.ivrm.jp/reports/2026-11-10.html',
      tpsAvg: 19.8,
      tpsMin: 17.2,
      cpuMaxHost: 87.5,
      playersMax: 6,
    });
    expect(embed.title).toContain('2026-11-10');
    expect(embed.url).toContain('2026-11-10');
    expect(embed.description).toContain('19.8');
    expect(embed.description).toContain('6 人');
  });

  it('JST の今日を返す', () => {
    expect(todayInTokyo(new Date('2026-11-10T16:30:00.000Z'))).toBe('2026-11-11');
  });
});

describe('Minecraft ホワイトリスト連携 (#894)', () => {
  it('承認ロール未設定なら全員拒否する (fail-closed)', () => {
    const config = normalizeMinecraftStatusConfig({});
    expect(
      canApproveMinecraftWhitelist({ member: { roles: ['1114417432346501130'] } }, config),
    ).toBe(false);
    expect(canApproveMinecraftWhitelist({ member: { roles: [] } }, config)).toBe(false);
  });

  it('承認ロール設定時は保持者だけを許可する', () => {
    const config = normalizeMinecraftStatusConfig({
      whitelistApproverRoleIds: ['222222222222222222'],
    });
    expect(
      canApproveMinecraftWhitelist({ member: { roles: ['222222222222222222'] } }, config),
    ).toBe(true);
    expect(
      canApproveMinecraftWhitelist({ member: { roles: ['333333333333333333'] } }, config),
    ).toBe(false);
    // サーバー操作の必須ロールでは承認できない (別系統)
    expect(
      canApproveMinecraftWhitelist({ member: { roles: ['1114417432346501130'] } }, config),
    ).toBe(false);
  });

  it('whitelistApproverRoleIds を正規化する', () => {
    expect(
      normalizeMinecraftStatusConfig({
        whitelistApproverRoleIds: ['123456789012345678', 'abc', '123456789012345678', 42],
      }),
    ).toMatchObject({ whitelistApproverRoleIds: ['123456789012345678'] });
  });

  it('Bot API 設定は env が揃わないと無効になる', () => {
    expect(resolveMinecraftBotApiConfig({})).toBeNull();
    expect(
      resolveMinecraftBotApiConfig({ IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp' }),
    ).toBeNull();
    expect(resolveMinecraftBotApiConfig({ HERTA_MINECRAFT_SYNC_SECRET: 'secret' })).toBeNull();
    expect(
      resolveMinecraftBotApiConfig({
        IVRM_WEB_API_BASE_URL: 'http://example.com',
        HERTA_MINECRAFT_SYNC_SECRET: 'secret',
      }),
    ).toBeNull();
    expect(
      resolveMinecraftBotApiConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/',
        HERTA_MINECRAFT_SYNC_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.ivrm.jp', secret: 'secret' });
  });

  it('Bot API リクエストは API 側と同じ署名形式で構築する', () => {
    const config = { apiBaseUrl: 'https://api.ivrm.jp', secret: 'secret' };
    const request = buildMinecraftBotApiRequest(
      config,
      '/minecraft/bot/link',
      { discordUserId: '234567890123456789', guildId: '123456789012345678' },
      { timestamp: '1760000000000', eventId: 'mc-test-event' },
    );
    const body = '{"discordUserId":"234567890123456789","guildId":"123456789012345678"}';
    const expected = createHmac('sha256', 'secret')
      .update(`1760000000000.mc-test-event.POST./minecraft/bot/link.${body}`)
      .digest('hex');
    expect(request.url).toBe('https://api.ivrm.jp/minecraft/bot/link');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe('mc-test-event');
    expect(request.init.body).toBe(body);
  });

  it('連携状態を整形する', () => {
    expect(
      formatMinecraftLinkStatus({
        status: 'approved',
        link: { minecraftUsername: 'Steve', minecraftUuid: 'x', linkedAt: null },
        request: null,
        whitelist: { status: 'synced', lastSyncedAt: null },
      }),
    ).toContain('連携済み');
    expect(
      formatMinecraftLinkStatus({
        status: 'pending',
        link: null,
        request: {
          id: 'mclr_1',
          minecraftUsername: 'Steve',
          status: 'pending',
          requestedAt: '2026-11-14T00:00:00.000Z',
          reviewNote: null,
        },
        whitelist: { status: 'not_requested', lastSyncedAt: null },
      }),
    ).toContain('mclr_1');
    expect(
      formatMinecraftLinkStatus({ status: 'none', link: null, request: null, whitelist: null }),
    ).toContain('member.ivrm.jp/minecraft');
  });

  it('審査待ち一覧とエラーを整形する', () => {
    expect(formatMinecraftPendingRequests({ requests: [] })).toContain('ありません');
    const list = formatMinecraftPendingRequests({
      requests: [
        {
          id: 'mclr_1',
          minecraftUsername: 'Steve',
          discordUsername: 'steve_d',
          requestedAt: '2026-11-14T00:00:00.000Z',
        },
      ],
    });
    expect(list).toContain('mclr_1');
    expect(list).toContain('Steve');
    expect(
      formatMinecraftBotApiError({ ok: false, status: 404, data: { code: 'user_not_registered' } }),
    ).toContain('member.ivrm.jp');
    expect(formatMinecraftBotApiError({ ok: false, status: 0, data: null })).toContain(
      '接続できませんでした',
    );
  });
});

describe('Minecraft ホワイトリスト審査 UX (Embed / ボタン / モーダル)', () => {
  const pendingData = {
    requests: [
      {
        id: 'mclr_1',
        minecraftUsername: 'Steve',
        discordUsername: 'steve_d',
        discordUserId: '111',
        requestedAt: '2026-11-16T07:06:05.444Z',
      },
      {
        id: 'mclr_2',
        minecraftUsername: 'Alex',
        discordUsername: 'alex_d',
        discordUserId: '222',
        requestedAt: '2026-11-16T08:00:00.000Z',
      },
    ],
  };

  it('pending 応答をサマリーに変換する (DM 用の discordUserId を含む)', () => {
    const parsed = parseMinecraftPendingRequests(pendingData);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: 'mclr_1',
      minecraftUsername: 'Steve',
      discordUserId: '111',
    });
    expect(parseMinecraftPendingRequests({})).toEqual([]);
  });

  it('申請ごとに承認・却下ボタンの行を作り、5件で打ち切る', () => {
    const rows = buildMinecraftPendingRequestRows(parseMinecraftPendingRequests(pendingData));
    expect(rows).toHaveLength(2);
    const firstButtons = rows[0]!.components;
    expect(
      firstButtons.map((button) => ('custom_id' in button ? button.custom_id : undefined)),
    ).toEqual(['mcw:approve:mclr_1', 'mcw:reject:mclr_1']);
    const many = {
      requests: Array.from({ length: 7 }, (_, index) => ({
        id: `mclr_${index}`,
        minecraftUsername: `User${index}`,
        discordUsername: `user${index}`,
        requestedAt: '2026-11-16T07:06:05.444Z',
      })),
    };
    expect(buildMinecraftPendingRequestRows(parseMinecraftPendingRequests(many))).toHaveLength(5);
    const embed = buildMinecraftPendingRequestsEmbed(parseMinecraftPendingRequests(many));
    expect(embed.footer?.text).toContain('先頭5件まで');
  });

  it('pending Embed は空ならその旨、あれば申請者ごとのフィールドになる', () => {
    const empty = buildMinecraftPendingRequestsEmbed([]);
    expect(empty.description).toContain('審査待ちの連携申請はありません');
    const embed = buildMinecraftPendingRequestsEmbed(parseMinecraftPendingRequests(pendingData));
    expect(embed.fields).toHaveLength(2);
    expect(embed.fields?.[0]?.name).toContain('Steve');
    expect(embed.fields?.[0]?.value).toContain('mclr_1');
  });

  it('customId を解析し、対象外や不正な形式は null にする', () => {
    expect(parseMinecraftWhitelistComponentId('mcw:approve:mclr_1')).toEqual({
      action: 'approve',
      requestId: 'mclr_1',
    });
    expect(parseMinecraftWhitelistComponentId('mcw:reject-submit:mclr_2')).toEqual({
      action: 'reject-submit',
      requestId: 'mclr_2',
    });
    expect(parseMinecraftWhitelistComponentId('daily-bonus:2026-11-16')).toBeNull();
    expect(parseMinecraftWhitelistComponentId('mcw:approve:')).toBeNull();
    expect(parseMinecraftWhitelistComponentId('mcw:unknown:mclr_1')).toBeNull();
  });

  it('却下モーダルは reject-submit の customId と必須の理由入力を持つ', () => {
    const modal = buildMinecraftRejectModal('mclr_9');
    expect(modal.custom_id).toBe('mcw:reject-submit:mclr_9');
    const row = modal.components[0] as unknown as {
      components: { custom_id: string; required?: boolean }[];
    };
    const input = row.components[0]!;
    expect(input.custom_id).toBe('note');
    expect(input.required).toBe(true);
  });

  it('連携状態 Embed は状態ごとに色と項目が変わる', () => {
    const approved = buildMinecraftLinkStatusEmbed({
      status: 'approved',
      link: { minecraftUsername: 'Steve' },
      whitelist: { status: 'synced' },
    });
    expect(approved.color).toBe(0x57f287);
    expect(approved.fields?.map((field) => field.name)).toEqual(['Minecraft', 'ホワイトリスト']);
    const pending = buildMinecraftLinkStatusEmbed({
      status: 'pending',
      request: { id: 'mclr_1', minecraftUsername: 'Steve' },
      whitelist: { status: 'not_requested' },
    });
    expect(pending.color).toBe(0xfee75c);
    expect(pending.fields?.map((field) => field.name)).toEqual(['Minecraft', '申請ID']);
  });

  it('審査結果 DM の Embed に却下理由が入る', () => {
    const embed = buildMinecraftReviewNoticeEmbed('reject', {
      minecraftUsername: 'Steve',
      note: '名前が一致しません',
    });
    expect(embed.title).toContain('却下されました');
    expect(embed.fields?.map((field) => field.name)).toEqual(['Minecraft', '却下理由']);
  });
});

describe('handleMinecraftWhitelistComponent', () => {
  const approverRoleId = '222222222222222222';
  const pendingEntry = {
    id: 'mclr_1',
    minecraftUsername: 'Steve',
    discordUsername: 'steve_d',
    discordUserId: '111',
    requestedAt: '2026-11-16T07:06:05.444Z',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['IVRM_WEB_API_BASE_URL'];
    delete process.env['HERTA_MINECRAFT_SYNC_SECRET'];
  });

  function setupFetch() {
    process.env['IVRM_WEB_API_BASE_URL'] = 'https://api.example.test';
    process.env['HERTA_MINECRAFT_SYNC_SECRET'] = 'test-secret';
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let pendingCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });
      if (url.endsWith('/minecraft/bot/requests/pending')) {
        pendingCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ requests: pendingCount === 1 ? [pendingEntry] : [] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  function makeContext(dmSend: ReturnType<typeof vi.fn>) {
    return {
      guildId: 'guild-1',
      config: normalizeMinecraftStatusConfig({
        enabled: true,
        ephemeralResponses: true,
        whitelistApproverRoleIds: [approverRoleId],
      }),
      client: {
        channels: { fetch: async () => null },
        users: {
          fetch: async (userId: string) => (userId === '111' ? { send: dmSend } : null),
        },
      },
    } as unknown as Parameters<typeof handleMinecraftWhitelistComponent>[0];
  }

  function makeInteraction(overrides: Record<string, unknown>) {
    return {
      guildId: 'guild-1',
      user: { id: 'approver-1' },
      member: { roles: [approverRoleId] },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      showModal: vi.fn(async () => {}),
      ...overrides,
    } as unknown as Parameters<typeof handleMinecraftWhitelistComponent>[1] & {
      reply: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      showModal: ReturnType<typeof vi.fn>;
    };
  }

  it('承認ロールが無いと API を呼ばずに拒否する', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({
      customId: 'mcw:approve:mclr_1',
      member: { roles: [] },
    });
    await handleMinecraftWhitelistComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(String(interaction.reply.mock.calls[0]?.[0]?.content)).toContain('専用ロールが必要');
    expect(calls.filter((call) => call.url.includes('/requests/approve'))).toHaveLength(0);
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('承認ボタンで API を呼び、一覧を更新し、申請者へ DM する', async () => {
    const calls = setupFetch();
    const dmSend = vi.fn(async () => {});
    const interaction = makeInteraction({ customId: 'mcw:approve:mclr_1' });
    await handleMinecraftWhitelistComponent(makeContext(dmSend), interaction);
    const approveCalls = calls.filter((call) => call.url.includes('/requests/approve'));
    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0]?.body).toMatchObject({
      requestId: 'mclr_1',
      approverRoleVerified: true,
    });
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(interaction.update).toHaveBeenCalledTimes(1);
    const updated = interaction.update.mock.calls[0]?.[0] as {
      embeds: { description?: string }[];
    };
    expect(updated.embeds[0]?.description).toContain('審査待ちの連携申請はありません');
  });

  it('却下ボタンはモーダルを開くだけで API を呼ばない', async () => {
    const calls = setupFetch();
    const interaction = makeInteraction({ customId: 'mcw:reject:mclr_1' });
    await handleMinecraftWhitelistComponent(makeContext(vi.fn(async () => {})), interaction);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('却下モーダルの送信で理由つきで却下し、DM して新しい一覧を返す', async () => {
    const calls = setupFetch();
    const dmSend = vi.fn(async () => {});
    const interaction = makeInteraction({
      customId: 'mcw:reject-submit:mclr_1',
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => '名前が一致しません' },
    });
    await handleMinecraftWhitelistComponent(makeContext(dmSend), interaction);
    const rejectCalls = calls.filter((call) => call.url.includes('/requests/reject'));
    expect(rejectCalls).toHaveLength(1);
    expect(rejectCalls[0]?.body).toMatchObject({
      requestId: 'mclr_1',
      reviewNote: '名前が一致しません',
    });
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});

describe('Minecraft ホワイトリスト審査リマインド (#916)', () => {
  const opsChannelId = '123456789012345678';
  const approverRoleId = '222222222222222222';
  const operatorId = '333333333333333333';
  const botUserId = '999999999999999999';
  const guildId = 'guild-reminder';
  const nowMs = Date.parse('2026-11-16T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(nowMs - hours * 60 * 60 * 1000).toISOString();

  const overdueEntry = {
    id: 'mclr_old',
    minecraftUsername: 'Steve',
    discordUsername: 'steve_d',
    discordUserId: '111111111111111111',
    requestedAt: hoursAgo(25),
  };
  const freshEntry = {
    id: 'mclr_new',
    minecraftUsername: 'Alex',
    discordUsername: 'alex_d',
    discordUserId: '444444444444444444',
    requestedAt: hoursAgo(2),
  };

  it('whitelistOpsChannelId を正規化する (未設定・不正値は無効)', () => {
    expect(normalizeMinecraftStatusConfig({}).whitelistOpsChannelId).toBe('');
    expect(
      normalizeMinecraftStatusConfig({ whitelistOpsChannelId: opsChannelId }).whitelistOpsChannelId,
    ).toBe(opsChannelId);
    expect(
      normalizeMinecraftStatusConfig({ whitelistOpsChannelId: 'abc' }).whitelistOpsChannelId,
    ).toBe('');
    expect(
      normalizeMinecraftStatusConfig({ whitelistOpsChannelId: 42 }).whitelistOpsChannelId,
    ).toBe('');
    expect(
      normalizeMinecraftStatusConfig({ whitelistOpsChannelId: '1234' }).whitelistOpsChannelId,
    ).toBe('');
  });

  it('24時間を超えた申請だけを対象にする (境界ちょうどは対象外)', () => {
    const requests = parseMinecraftPendingRequests({
      requests: [
        overdueEntry,
        {
          id: 'mclr_edge',
          minecraftUsername: 'Edge',
          discordUsername: 'edge_d',
          requestedAt: hoursAgo(24),
        },
        {
          id: 'mclr_just',
          minecraftUsername: 'Just',
          discordUsername: 'just_d',
          requestedAt: new Date(
            nowMs - MINECRAFT_WHITELIST_REMINDER_THRESHOLD_MS - 1000,
          ).toISOString(),
        },
        freshEntry,
        {
          id: 'mclr_none',
          minecraftUsername: 'None',
          discordUsername: 'none_d',
          requestedAt: null,
        },
        {
          id: 'mclr_bad',
          minecraftUsername: 'Bad',
          discordUsername: 'bad_d',
          requestedAt: 'not-a-date',
        },
      ],
    });
    expect(selectOverdueMinecraftRequests(requests, nowMs).map((request) => request.id)).toEqual([
      'mclr_old',
      'mclr_just',
    ]);
  });

  it('リマインド Embed に経過時間・申請者メンション・申請IDが入る', () => {
    const [request] = parseMinecraftPendingRequests({ requests: [overdueEntry] });
    expect(request).toBeDefined();
    expect(minecraftPendingElapsedHours(request!, nowMs)).toBe(25);
    const embed = buildMinecraftWhitelistReminderEmbed([request!], nowMs);
    expect(embed.title).toContain('リマインド');
    expect(embed.description).toContain('1 件');
    expect(embed.fields?.[0]?.name).toContain('Steve');
    expect(embed.fields?.[0]?.value).toContain('約25時間');
    expect(embed.fields?.[0]?.value).toContain('<@111111111111111111>');
    expect(embed.fields?.[0]?.value).toContain('申請ID: mclr_old');
  });

  it('直近24時間の Bot 自身のリマインドから申請IDを集める', () => {
    const messages = [
      {
        author: { id: botUserId },
        createdTimestamp: nowMs - 60 * 60 * 1000,
        embeds: [{ fields: [{ name: '🎮 Steve', value: '申請ID: mclr_old' }] }],
      },
      {
        // 他人の投稿に含まれる申請IDは対象外
        author: { id: '555555555555555555' },
        createdTimestamp: nowMs - 60 * 1000,
        content: '申請ID: mclr_other',
      },
      {
        // 24時間より前のリマインドは対象外 (再通知してよい)
        author: { id: botUserId },
        createdTimestamp: nowMs - 25 * 60 * 60 * 1000,
        content: '申請ID: mclr_ancient',
      },
    ];
    expect([...collectRecentlyRemindedRequestIds(messages, botUserId, nowMs)]).toEqual([
      'mclr_old',
    ]);
  });

  describe('runMinecraftWhitelistReminderCycle', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env['IVRM_WEB_API_BASE_URL'];
      delete process.env['HERTA_MINECRAFT_SYNC_SECRET'];
    });

    function setupFetch(requests: unknown[]) {
      process.env['IVRM_WEB_API_BASE_URL'] = 'https://api.example.test';
      process.env['HERTA_MINECRAFT_SYNC_SECRET'] = 'test-secret';
      const calls: { url: string; body: Record<string, unknown> }[] = [];
      const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
        const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        calls.push({ url, body });
        if (url.endsWith('/minecraft/bot/requests/pending')) {
          return { ok: true, status: 200, json: async () => ({ requests }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });
      vi.stubGlobal('fetch', fetchMock);
      return calls;
    }

    function makeContext(options: {
      config?: Record<string, unknown>;
      history?: unknown[];
      send: ReturnType<typeof vi.fn>;
    }) {
      const channel = {
        guildId,
        isTextBased: () => true,
        send: options.send,
        messages: {
          fetch: async () => ({ values: () => (options.history ?? []).values() }),
        },
      };
      return {
        guildId,
        config: options.config ?? {
          enabled: true,
          whitelistApproverRoleIds: [approverRoleId],
          whitelistOpsChannelId: opsChannelId,
        },
        client: {
          user: { id: botUserId },
          channels: { fetch: async () => channel },
          users: { fetch: async () => null },
          guilds: {
            fetch: async () => ({
              roles: {
                fetch: async (roleId: string) =>
                  roleId === approverRoleId ? { members: new Map([[operatorId, {}]]) } : null,
              },
            }),
          },
        },
      } as unknown as Parameters<typeof runMinecraftWhitelistReminderCycle>[0];
    }

    it('24時間超の審査待ちを運営チャンネルへ通知する (メンションなし)', async () => {
      const calls = setupFetch([overdueEntry, freshEntry]);
      let sentPayload:
        | {
            content?: string;
            embeds: { fields?: { value: string }[] }[];
            allowedMentions: { parse: [] };
          }
        | undefined;
      const send = vi.fn(async (options: unknown) => {
        sentPayload = options as typeof sentPayload;
      });
      await runMinecraftWhitelistReminderCycle(makeContext({ send }), nowMs);
      expect(send).toHaveBeenCalledTimes(1);
      // メンションは P0 レベルの緊急アラートのみ。リマインドはロールメンションも付けない
      expect(sentPayload?.content).toBeUndefined();
      expect(sentPayload?.allowedMentions).toEqual({ parse: [] });
      expect(sentPayload?.embeds[0]?.fields).toHaveLength(1);
      expect(sentPayload?.embeds[0]?.fields?.[0]?.value).toContain('mclr_old');
      // 実行者は承認ロールの保持者で、ロール確認済みとして API を呼ぶ
      expect(calls[0]?.body).toMatchObject({
        discordUserId: operatorId,
        guildId,
        approverRoleVerified: true,
      });
    });

    it('直近24時間に通知済みの申請は再通知しない', async () => {
      setupFetch([overdueEntry]);
      const send = vi.fn(async () => {});
      const history = [
        {
          author: { id: botUserId },
          createdTimestamp: nowMs - 60 * 60 * 1000,
          embeds: [{ fields: [{ name: '🎮 Steve', value: '申請ID: mclr_old' }] }],
        },
      ];
      await runMinecraftWhitelistReminderCycle(makeContext({ send, history }), nowMs);
      expect(send).not.toHaveBeenCalled();
    });

    it('運営チャンネル未設定なら API も呼ばず無効のまま動く', async () => {
      const calls = setupFetch([overdueEntry]);
      const send = vi.fn(async () => {});
      await runMinecraftWhitelistReminderCycle(
        makeContext({
          send,
          config: { enabled: true, whitelistApproverRoleIds: [approverRoleId] },
        }),
        nowMs,
      );
      expect(calls).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
    });

    it('24時間超の審査待ちが無ければ通知しない', async () => {
      setupFetch([freshEntry]);
      const send = vi.fn(async () => {});
      await runMinecraftWhitelistReminderCycle(makeContext({ send }), nowMs);
      expect(send).not.toHaveBeenCalled();
    });

    it('API が失敗しても例外にならず通知しない', async () => {
      process.env['IVRM_WEB_API_BASE_URL'] = 'https://api.example.test';
      process.env['HERTA_MINECRAFT_SYNC_SECRET'] = 'test-secret';
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
      );
      const send = vi.fn(async () => {});
      await expect(
        runMinecraftWhitelistReminderCycle(makeContext({ send }), nowMs),
      ).resolves.toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    });

    it('探索できなくても、操作で検証済みの運営者の記憶で取得できる', async () => {
      const calls = setupFetch([overdueEntry]);
      const send = vi.fn(async () => {});
      rememberMinecraftWhitelistOperator(guildId, operatorId);
      const context = makeContext({ send });
      (context.client as { guilds?: unknown }).guilds = undefined;
      await runMinecraftWhitelistReminderCycle(context, nowMs);
      expect(send).toHaveBeenCalledTimes(1);
      expect(calls[0]?.body).toMatchObject({ discordUserId: operatorId });
    });
  });
});
