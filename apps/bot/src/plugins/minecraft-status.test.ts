import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  bar,
  buildMinecraftBotApiRequest,
  buildMinecraftControlSignature,
  canApproveMinecraftWhitelist,
  canControlMinecraftServer,
  formatMinecraftBotApiError,
  formatMinecraftLinkStatus,
  formatMinecraftPendingRequests,
  resolveMinecraftBotApiConfig,
  minecraftControlImmediateMessage,
  minecraftControlPath,
  normalizeCpuPercent,
  buildMinecraftStatusCardModel,
  buildMinecraftStatusEmbed,
  buildMinecraftStatusImageEmbed,
  memberRoleIds,
  MINECRAFT_STATUS_CURRENT_URL_DEFAULT,
  MINECRAFT_STATUS_RUNTIME_URL_DEFAULT,
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
