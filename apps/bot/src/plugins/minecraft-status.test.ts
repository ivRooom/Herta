import { describe, expect, it } from 'vitest';
import {
  bar,
  buildMinecraftStatusEmbed,
  MINECRAFT_STATUS_CURRENT_URL_DEFAULT,
  MINECRAFT_STATUS_RUNTIME_URL_DEFAULT,
  normalizeMinecraftStatusConfig,
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
    { id: 'mc-resource', containerState: 'exited', health: 'unhealthy', runtimeStatus: 'sleeping' },
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
      showServers: true,
      showBackup: true,
      staleAfterMinutes: 3,
    });
    expect(normalizeMinecraftStatusConfig({ staleAfterMinutes: 999 })).toMatchObject({
      staleAfterMinutes: 60,
    });
    expect(normalizeMinecraftStatusConfig({ enabled: false })).toMatchObject({ enabled: false });
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
    expect(embed?.description).toContain('接続先: `mc.ivrm.jp`');
    expect(field(embed, '👥 プレイヤー')?.value).toContain('**2 / 10**');
    expect(field(embed, '👥 プレイヤー')?.value).toContain('██░░░░░░░░');
    expect(field(embed, '🎮 オンライン')?.value).toBe('ivurugg, kanata');
    expect(field(embed, '⏱ 稼働時間')?.value).toBe('12時間 36分');
    const resources = field(embed, '📊 リソース')?.value ?? '';
    expect(resources).toContain('CPU');
    expect(resources).toContain('1.09%');
    expect(resources).toContain('メモリ');
    expect(resources).toContain('27%');
    expect(resources).toContain('ホストメモリ');
    expect(resources).toContain('56%');
    expect(resources).toContain('Load `0.31, 0.34, 0.53`');
    expect(field(embed, '💾 最新バックアップ')?.value).toBe('2026-11-10 03:00:46（937M）');
    const servers = field(embed, '🖥 サーバー状態')?.value ?? '';
    expect(servers).toContain('🟢 **mc-main** — 稼働中（正常）');
    expect(servers).toContain('🔴 **mc-resource** — スリープ中（異常）');
    expect(embed?.footer?.text).not.toContain('データが古い可能性があります');
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
