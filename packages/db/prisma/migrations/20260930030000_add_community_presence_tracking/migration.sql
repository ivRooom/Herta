-- CreateTable
CREATE TABLE "community_presence_sessions" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_presence_sessions_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "community_game_sessions" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_name" VARCHAR(128) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_game_sessions_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "community_game_activity_daily" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_name" VARCHAR(128) NOT NULL,
    "activity_date" DATE NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_game_activity_daily_pkey" PRIMARY KEY ("guild_id","user_id","activity_name","activity_date")
);

-- CreateIndex
CREATE INDEX "community_presence_sessions_guild_id_started_at_idx"
    ON "community_presence_sessions"("guild_id", "started_at");

-- CreateIndex
CREATE INDEX "community_game_sessions_guild_id_started_at_idx"
    ON "community_game_sessions"("guild_id", "started_at");

-- CreateIndex
CREATE INDEX "community_game_activity_daily_guild_id_activity_name_activi_idx"
    ON "community_game_activity_daily"("guild_id", "activity_name", "activity_date");
