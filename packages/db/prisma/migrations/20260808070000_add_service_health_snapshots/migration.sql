CREATE TABLE "service_health_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "discord_status" TEXT NOT NULL,
    "database_status" TEXT NOT NULL,
    "redis_status" TEXT NOT NULL,
    "worker_status" TEXT NOT NULL,
    "database_latency_ms" INTEGER,
    "redis_latency_ms" INTEGER,
    "worker_latency_ms" INTEGER,
    "guild_count" INTEGER NOT NULL DEFAULT 0,
    "uptime_seconds" INTEGER NOT NULL DEFAULT 0,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_health_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_health_snapshots_status_check"
      CHECK ("status" IN ('operational', 'degraded', 'outage', 'maintenance', 'unknown')),
    CONSTRAINT "service_health_snapshots_guild_count_check" CHECK ("guild_count" >= 0),
    CONSTRAINT "service_health_snapshots_uptime_seconds_check" CHECK ("uptime_seconds" >= 0),
    CONSTRAINT "service_health_snapshots_database_latency_ms_check"
      CHECK ("database_latency_ms" IS NULL OR "database_latency_ms" >= 0),
    CONSTRAINT "service_health_snapshots_redis_latency_ms_check"
      CHECK ("redis_latency_ms" IS NULL OR "redis_latency_ms" >= 0),
    CONSTRAINT "service_health_snapshots_worker_latency_ms_check"
      CHECK ("worker_latency_ms" IS NULL OR "worker_latency_ms" >= 0)
);

CREATE INDEX "service_health_snapshots_service_id_checked_at_idx"
  ON "service_health_snapshots"("service_id", "checked_at" DESC);

CREATE INDEX "service_health_snapshots_checked_at_idx"
  ON "service_health_snapshots"("checked_at" DESC);
