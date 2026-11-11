import { describe, expect, it } from 'vitest';
import {
  renderMinecraftStatusCard,
  type MinecraftStatusCardModel,
} from './minecraft-status-card.js';

const model: MinecraftStatusCardModel = {
  serverName: 'IVRM Main',
  statusText: 'オンライン',
  statusTone: 'online',
  connection: 'mc.ivrm.jp',
  mode: 'Minecraft 26.1.2 / NeoForge / Main',
  players: { online: 2, max: 10, ratio: 0.2, namesLine: 'ivurugg, kanata' },
  resources: { cpuPercent: 1.09, memoryPercent: 27, hostMemoryPercent: 56, loadAverage: '0.31' },
  servers: [
    { name: 'mc-main', stateLabel: '稼働中（正常）', tone: 'ok' },
    { name: 'mc-resource', stateLabel: '休止中（接続で自動起動）', tone: 'sleep' },
  ],
  uptime: '12時間 36分',
  hostLabel: 'Oracle Cloud · Oracle Linux 9.7 · Neoverse-N1 · 2コア',
  backupLabel: '11/10 03:00（937M）',
};

describe('Minecraft Status Card', () => {
  it('PNGとして描画できる', async () => {
    const png = await renderMinecraftStatusCard(model);
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('最小構成でも描画できる', async () => {
    const png = await renderMinecraftStatusCard({
      serverName: 'Minecraft',
      statusText: '状態不明',
      statusTone: 'unknown',
    });
    expect(png.length).toBeGreaterThan(500);
  });
});
