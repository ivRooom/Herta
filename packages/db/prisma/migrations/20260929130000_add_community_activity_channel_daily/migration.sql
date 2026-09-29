-- CreateTable
CREATE TABLE "community_activity_channel_daily" (
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_date" DATE NOT NULL,
    "metric" VARCHAR(32) NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_activity_channel_daily_pkey" PRIMARY KEY ("guild_id","channel_id","user_id","activity_date","metric")
);

-- CreateIndex
CREATE INDEX "community_activity_channel_daily_guild_id_channel_id_metric_idx"
    ON "community_activity_channel_daily"("guild_id", "channel_id", "metric", "activity_date");

-- CreateIndex
CREATE INDEX "community_activity_channel_daily_guild_id_metric_activity_d_idx"
    ON "community_activity_channel_daily"("guild_id", "metric", "activity_date");
