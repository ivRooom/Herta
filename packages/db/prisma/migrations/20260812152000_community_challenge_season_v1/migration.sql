CREATE TABLE "community_challenge_assignments" (
  "guild_id" TEXT NOT NULL,
  "period_type" VARCHAR(16) NOT NULL,
  "period_key" VARCHAR(32) NOT NULL,
  "challenge_ids" TEXT[] NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "community_challenge_assignments_pkey"
    PRIMARY KEY ("guild_id", "period_type", "period_key"),
  CONSTRAINT "community_challenge_assignments_period_type_check"
    CHECK ("period_type" IN ('daily', 'weekly')),
  CONSTRAINT "community_challenge_assignments_count_check"
    CHECK (cardinality("challenge_ids") BETWEEN 1 AND 5),
  CONSTRAINT "community_challenge_assignments_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "community_challenge_assignments_guild_created_idx"
  ON "community_challenge_assignments" ("guild_id", "created_at" DESC);

CREATE TABLE "community_challenge_completions" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "challenge_id" VARCHAR(96) NOT NULL,
  "period_type" VARCHAR(16) NOT NULL,
  "period_key" VARCHAR(32) NOT NULL,
  "season_key" VARCHAR(32) NOT NULL,
  "points" INTEGER NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "community_challenge_completions_pkey"
    PRIMARY KEY ("guild_id", "user_id", "challenge_id", "period_type", "period_key"),
  CONSTRAINT "community_challenge_completions_period_type_check"
    CHECK ("period_type" IN ('daily', 'weekly')),
  CONSTRAINT "community_challenge_completions_points_check"
    CHECK ("points" >= 0),
  CONSTRAINT "community_challenge_completions_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "community_challenge_completions_guild_user_completed_idx"
  ON "community_challenge_completions" ("guild_id", "user_id", "completed_at" DESC);
CREATE INDEX "community_challenge_completions_guild_season_points_idx"
  ON "community_challenge_completions" ("guild_id", "season_key", "points" DESC);
CREATE INDEX "community_challenge_completions_guild_period_idx"
  ON "community_challenge_completions" ("guild_id", "period_type", "period_key");
