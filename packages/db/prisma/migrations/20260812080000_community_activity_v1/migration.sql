CREATE TABLE "community_activity_daily" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "activity_date" DATE NOT NULL,
  "metric" VARCHAR(32) NOT NULL,
  "value" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_activity_daily_pkey" PRIMARY KEY ("guild_id", "user_id", "activity_date", "metric")
);

CREATE INDEX "community_activity_daily_guild_id_metric_activity_date_idx"
  ON "community_activity_daily"("guild_id", "metric", "activity_date");
CREATE INDEX "community_activity_daily_guild_id_user_id_activity_date_idx"
  ON "community_activity_daily"("guild_id", "user_id", "activity_date");

CREATE TABLE "community_voice_sessions" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_voice_sessions_pkey" PRIMARY KEY ("guild_id", "user_id")
);

CREATE INDEX "community_voice_sessions_guild_id_started_at_idx"
  ON "community_voice_sessions"("guild_id", "started_at");
