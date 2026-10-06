-- CreateTable
CREATE TABLE "member_activity_events" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT,
    "event" VARCHAR(32) NOT NULL,
    "channel_id" TEXT,
    "message_id" TEXT,
    "content" TEXT,
    "content_scrubbed_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_activity_events_guild_id_occurred_at_idx" ON "member_activity_events"("guild_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "member_activity_events_guild_id_user_id_occurred_at_idx" ON "member_activity_events"("guild_id", "user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "member_activity_events_guild_id_event_occurred_at_idx" ON "member_activity_events"("guild_id", "event", "occurred_at" DESC);
