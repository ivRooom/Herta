import type { Logger } from '@herta/logger';
import type { HealthConfig } from './config.js';
import { resolveHealthReason, resolveOverallHealth } from './status.js';
import type {
  DependencyHealthCheck,
  DiscordHealthCheck,
  DiscordHealthObservation,
  HealthChecks,
  HertaHealthResponse,
  PublicServiceStatus,
  WorkerHealthCheck,
} from './types.js';

export interface HealthProbes {
  discord: () => DiscordHealthObservation;
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
  workerHeartbeat?: () => Promise<string | null>;
}

export interface HertaHealthServiceOptions {
  config: HealthConfig;
  probes: HealthProbes;
  logger: Logger;
  version: string;
  now?: () => Date;
  uptimeSeconds?: () => number;
}

interface CachedHealth {
  response: HertaHealthResponse;
  createdAtMs: number;
}

function dependencyFailure(): DependencyHealthCheck {
  return { status: 'error', message: 'dependency check failed' };
}

function unknownDependency(): DependencyHealthCheck {
  return { status: 'unknown', message: 'dependency check failed' };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timeout')), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createUnknownHealthResponse(
  checkedAt: Date,
  version: string,
  uptimeSeconds: number,
): HertaHealthResponse {
  return {
    service: { id: 'herta-discord-bot', name: 'Herta', type: 'discord_bot' },
    status: 'unknown',
    checked_at: checkedAt.toISOString(),
    uptime_seconds: Math.max(0, Math.floor(uptimeSeconds)),
    version,
    checks: {
      process: { status: 'ok' },
      discord: {
        status: 'unknown',
        connected: false,
        ready: false,
        gateway_status: 'unknown',
        reconnecting: false,
        last_ready_at: null,
        last_heartbeat_at: null,
        last_disconnect_at: null,
        heartbeat_source: 'unknown',
        message: 'dependency check failed',
      },
      database: unknownDependency(),
      redis: { status: 'not_configured' },
      worker: { status: 'not_configured' },
    },
  };
}

export class HertaHealthService {
  private cached?: CachedHealth;
  private inFlight?: Promise<HertaHealthResponse>;
  private previousStatus?: PublicServiceStatus;
  private readonly now: () => Date;
  private readonly uptimeSeconds: () => number;

  constructor(private readonly options: HertaHealthServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.uptimeSeconds = options.uptimeSeconds ?? (() => process.uptime());
  }

  async getHealth(): Promise<HertaHealthResponse> {
    const nowMs = this.now().getTime();
    if (
      this.cached &&
      nowMs - this.cached.createdAtMs >= 0 &&
      nowMs - this.cached.createdAtMs < this.options.config.cacheTtlMs
    ) {
      return this.cached.response;
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.collectHealth()
      .then((response) => {
        this.cached = { response, createdAtMs: this.now().getTime() };
        this.logStatusChange(response);
        return response;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  private async collectHealth(): Promise<HertaHealthResponse> {
    const checkedAt = this.now();
    const [discordResult, databaseResult, redisResult, workerResult] = await Promise.allSettled([
      Promise.resolve().then(() => this.checkDiscord(checkedAt)),
      this.checkDependency(this.options.probes.database),
      this.checkDependency(this.options.probes.redis),
      this.checkWorker(checkedAt),
    ]);

    const checks: HealthChecks = {
      process: { status: 'ok' },
      discord:
        discordResult.status === 'fulfilled'
          ? discordResult.value
          : {
              status: 'unknown',
              connected: false,
              ready: false,
              gateway_status: 'unknown',
              reconnecting: false,
              last_ready_at: null,
              last_heartbeat_at: null,
              last_disconnect_at: null,
              heartbeat_source: 'unknown',
              message: 'dependency check failed',
            },
      database:
        databaseResult.status === 'fulfilled' ? databaseResult.value : unknownDependency(),
      redis: redisResult.status === 'fulfilled' ? redisResult.value : unknownDependency(),
      worker: workerResult.status === 'fulfilled' ? workerResult.value : unknownDependency(),
    };

    return {
      service: { id: 'herta-discord-bot', name: 'Herta', type: 'discord_bot' },
      status: resolveOverallHealth(checks),
      checked_at: checkedAt.toISOString(),
      uptime_seconds: Math.max(0, Math.floor(this.uptimeSeconds())),
      version: this.options.version,
      checks,
    };
  }

  private checkDiscord(checkedAt: Date): DiscordHealthCheck {
    const observation = this.options.probes.discord();
    const lastHeartbeatAt = observation.lastHeartbeatAt;
    let status: DiscordHealthCheck['status'] = 'ok';

    if (!observation.connected || !observation.ready) {
      status = 'error';
    } else if (!lastHeartbeatAt) {
      status = 'unknown';
    } else {
      const heartbeatAgeMs = checkedAt.getTime() - lastHeartbeatAt.getTime();
      if (heartbeatAgeMs > this.options.config.heartbeatStaleMs) {
        status = 'error';
      } else if (heartbeatAgeMs > this.options.config.heartbeatStaleMs * 0.75) {
        status = 'warning';
      }
    }

    return {
      status,
      connected: observation.connected,
      ready: observation.ready,
      gateway_status: observation.gatewayStatus,
      reconnecting: observation.reconnecting,
      last_ready_at: observation.lastReadyAt?.toISOString() ?? null,
      last_heartbeat_at: lastHeartbeatAt?.toISOString() ?? null,
      last_disconnect_at: observation.lastDisconnectAt?.toISOString() ?? null,
      heartbeat_source: observation.heartbeatSource,
      ...(status === 'error' || status === 'unknown'
        ? { message: 'dependency check failed' as const }
        : {}),
    };
  }

  private async checkDependency(
    probe: (() => Promise<void>) | undefined,
  ): Promise<DependencyHealthCheck> {
    if (!probe) return { status: 'not_configured' };

    const startedAt = Date.now();
    try {
      await withTimeout(Promise.resolve().then(probe), this.options.config.checkTimeoutMs);
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const warningThresholdMs = Math.max(250, this.options.config.checkTimeoutMs * 0.8);
      return {
        status: latencyMs >= warningThresholdMs ? 'warning' : 'ok',
        latency_ms: latencyMs,
      };
    } catch {
      return dependencyFailure();
    }
  }

  private async checkWorker(checkedAt: Date): Promise<WorkerHealthCheck> {
    const probe = this.options.probes.workerHeartbeat;
    if (!probe) return { status: 'not_configured' };

    const startedAt = Date.now();
    try {
      const heartbeatValue = await withTimeout(
        Promise.resolve().then(probe),
        this.options.config.checkTimeoutMs,
      );
      const latencyMs = Math.max(0, Date.now() - startedAt);
      if (!heartbeatValue) return dependencyFailure();

      const heartbeatAt = new Date(heartbeatValue);
      if (Number.isNaN(heartbeatAt.getTime())) return dependencyFailure();

      const ageMs = checkedAt.getTime() - heartbeatAt.getTime();
      const status: WorkerHealthCheck['status'] =
        ageMs > this.options.config.heartbeatStaleMs
          ? 'error'
          : ageMs > this.options.config.heartbeatStaleMs * 0.75
            ? 'warning'
            : 'ok';

      return {
        status,
        latency_ms: latencyMs,
        last_heartbeat_at: heartbeatAt.toISOString(),
        ...(status === 'error' ? { message: 'dependency check failed' as const } : {}),
      };
    } catch {
      return dependencyFailure();
    }
  }

  private logStatusChange(response: HertaHealthResponse): void {
    const current = response.status;
    const previous = this.previousStatus;
    this.previousStatus = current;
    if (!previous || previous === current) return;

    this.options.logger.warn(
      {
        event: 'health_status_changed',
        previous,
        current,
        reason: resolveHealthReason(response.checks),
      },
      'Herta health status changed',
    );
  }
}
