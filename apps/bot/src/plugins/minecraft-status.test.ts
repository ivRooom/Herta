import { describe, expect, it } from 'vitest';
import {
  formatMinecraftStatus,
  normalizeMinecraftStatusConfig,
  type MinecraftCurrentStatus,
  type MinecraftRuntimeStatus,
} from './minecraft-status.js';

const now = new Date('2026-11-10T01:00:00.000Z');

const current: MinecraftCurrentStatus = {
  status: 'online',
  collected_at: '2026-11-10T00:59:00.000Z',
  server: { name: 'IVRM Main', mode: 'Minecraft 26.1.2 / NeoForge / Main', connection: 'mc.ivrm.jp' },
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
    latest_local: { file: 'minecraft-main-20261110-030000.tar.gz', size: '937M', mtime: '2026-11-10 03:00:46' },
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

  it('稼働状態・プレイヤー・リソース・サーバー状態を表示する', () => {
    const output = formatMinecraftStatus(current, runtime, normalizeMinecraftStatusConfig(undefined), now);
    expect(output).toContain('IVRM Main — 🟢 オンライン');
    expect(output).toContain('接続先: `mc.ivrm.jp`');
    expect(output).toContain('プレイヤー: **2 / 10**');
    expect(output).toContain('オンライン: ivurugg, kanata');
    expect(output).toContain('稼働時間: **12時間 36分**');
    expect(output).toContain('CPU 1.09%');
    expect(output).toContain('最新バックアップ: 2026-11-10 03:00:46（937M）');
    expect(output).toContain('• mc-main: 稼働中（正常）');
    expect(output).toContain('• mc-resource: スリープ中（異常）');
    expect(output).not.toContain('データが古い可能性があります');
  });

  it('古いデータには stale 警告を付ける', () => {
    const staleCurrent = { ...current, collected_at: '2026-11-10T00:30:00.000Z' };
    const staleRuntime = { ...runtime, generatedAt: '2026-11-10T00:30:00.000Z' };
    const output = formatMinecraftStatus(
      staleCurrent,
      staleRuntime,
      normalizeMinecraftStatusConfig(undefined),
      now,
    );
    expect(output).toContain('データが古い可能性があります');
  });

  it('表示フラグOFFの項目を省略する', () => {
    const config = { ...normalizeMinecraftStatusConfig(undefined), showResources: false, showServers: false, showBackup: false };
    const output = formatMinecraftStatus(current, runtime, config, now);
    expect(output).not.toContain('リソース:');
    expect(output).not.toContain('サーバー状態:');
    expect(output).not.toContain('最新バックアップ:');
  });

  it('片方のデータだけでも表示し、両方欠けたら取得失敗を返す', () => {
    const onlyRuntime = formatMinecraftStatus(null, runtime, normalizeMinecraftStatusConfig(undefined), now);
    expect(onlyRuntime).toContain('🟢 オンライン');
    expect(onlyRuntime).toContain('プレイヤー: **2 / 10**');

    const none = formatMinecraftStatus(null, null, normalizeMinecraftStatusConfig(undefined), now);
    expect(none).toContain('取得できませんでした');
  });

  it('オフライン状態を表示する', () => {
    const offline: MinecraftCurrentStatus = { status: 'offline', collected_at: '2026-11-10T00:59:00.000Z' };
    const output = formatMinecraftStatus(offline, null, normalizeMinecraftStatusConfig(undefined), now);
    expect(output).toContain('🔴 オフライン');
  });
});
