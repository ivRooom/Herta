import type { Client } from 'discord.js';
import type { DiscordHealthObservation, GatewayConnectionStatus } from './types.js';

export class DiscordHealthTracker {
  private connected = false;
  private reconnecting = false;
  private lastReadyAt: Date | null = null;
  private lastHeartbeatAt: Date | null = null;
  private lastDisconnectAt: Date | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  markReady(): void {
    const now = this.now();
    this.connected = true;
    this.reconnecting = false;
    this.lastReadyAt = now;
    this.lastHeartbeatAt = now;
  }

  markReconnecting(): void {
    this.connected = false;
    this.reconnecting = true;
  }

  markDisconnected(): void {
    this.connected = false;
    this.reconnecting = false;
    this.lastDisconnectAt = this.now();
  }

  markResumed(): void {
    this.connected = true;
    this.reconnecting = false;
    this.lastHeartbeatAt = this.now();
  }

  /**
   * discord.jsはHeartbeat ACK時刻を公開APIで提供しないため、ready状態とGateway pingを
   * 定期観測し、「最後にGatewayが健全と確認できた時刻」として安全に近似する。
   */
  observe(client: Client): void {
    const ping = client.ws.ping;
    if (client.isReady() && Number.isFinite(ping) && ping >= 0) {
      this.connected = true;
      this.reconnecting = false;
      this.lastHeartbeatAt = this.now();
    }
  }

  snapshot(client: Client): DiscordHealthObservation {
    const ready = client.isReady();
    const gatewayStatus: GatewayConnectionStatus = this.reconnecting
      ? 'reconnecting'
      : ready && this.connected
        ? 'ready'
        : this.connected
          ? 'connecting'
          : this.lastDisconnectAt
            ? 'disconnected'
            : 'unknown';

    return {
      connected: this.connected && ready,
      ready,
      gatewayStatus,
      reconnecting: this.reconnecting,
      lastReadyAt: this.lastReadyAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastDisconnectAt: this.lastDisconnectAt,
      heartbeatSource: this.lastHeartbeatAt ? 'gateway_status_observation' : 'unknown',
    };
  }
}
