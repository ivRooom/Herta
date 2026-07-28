CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guild_id" TEXT NOT NULL,
    "case_number" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "moderator_user_id" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "duration_seconds" INTEGER,
    "expires_at" TIMESTAMPTZ(3),
    "discord_action_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_cases_guild_id_fkey"
      FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "moderation_cases_action_check"
      CHECK ("action" IN ('warn', 'timeout', 'kick', 'ban')),
    CONSTRAINT "moderation_cases_status_check"
      CHECK ("status" IN ('active', 'completed', 'revoked', 'failed')),
    CONSTRAINT "moderation_cases_source_check"
      CHECK ("source" IN ('discord', 'dashboard')),
    CONSTRAINT "moderation_cases_duration_seconds_check"
      CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0)
);

CREATE UNIQUE INDEX "moderation_cases_guild_id_case_number_key"
  ON "moderation_cases"("guild_id", "case_number");

CREATE INDEX "moderation_cases_guild_id_created_at_idx"
  ON "moderation_cases"("guild_id", "created_at" DESC);

CREATE INDEX "moderation_cases_guild_id_target_user_id_created_at_idx"
  ON "moderation_cases"("guild_id", "target_user_id", "created_at" DESC);

CREATE INDEX "moderation_cases_guild_id_action_status_idx"
  ON "moderation_cases"("guild_id", "action", "status");
