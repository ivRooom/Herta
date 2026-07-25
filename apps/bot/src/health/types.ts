export type PublicServiceStatus =
  | 'operational'
  | 'degraded'
  | 'outage'
  | 'maintenance'
  | 'unknown';

export type InternalCheckStatus = 'ok' | 'warning' | 'error' | 'not_configured' | 'unknown';

export type GatewayConnectionStatus =
  | 'ready'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown';

export interface PublicServiceIdentity {
  id: 'herta-discord-bot';
  name: 'Herta';
  type: 'discord_bot';
}

export interface BaseHealthCheck {
  status: InternalCheckStatus;
  message?: 'dependency check failed';
}

export interface ProcessHealthCheck extends BaseHealthCheck {
  status: 'ok';
}

export interface DiscordHealthCheck extends BaseHealthCheck {
  connected: boolean;
  ready: boolean;
  gateway_status: GatewayConnectionStatus;
  reconnecting: boolean;
  last_ready_at: string | null;
  last_heartbeat_at: string | null;
  last_disconnect_at: string | null;
  heartbeat_source: 'gateway_status_observation' | 'unknown';
}

export interface DependencyHealthCheck extends BaseHealthCheck {
  latency_ms?: number;
}

export interface WorkerHealthCheck extends DependencyHealthCheck {
  last_heartbeat_at?: string | null;
}

export interface HealthChecks {
  process: ProcessHealthCheck;
  discord: DiscordHealthCheck;
  database: DependencyHealthCheck;
  redis: DependencyHealthCheck;
  worker: WorkerHealthCheck;
}

export interface HertaHealthResponse {
  service: PublicServiceIdentity;
  status: PublicServiceStatus;
  checked_at: string;
  uptime_seconds: number;
  version: string;
  checks: HealthChecks;
}

export interface DiscordHealthObservation {
  connected: boolean;
  ready: boolean;
  gatewayStatus: GatewayConnectionStatus;
  reconnecting: boolean;
  lastReadyAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastDisconnectAt: Date | null;
  heartbeatSource: 'gateway_status_observation' | 'unknown';
}
