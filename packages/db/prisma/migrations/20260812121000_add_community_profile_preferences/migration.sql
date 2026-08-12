CREATE TABLE "community_profile_preferences" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "is_public" BOOLEAN NOT NULL DEFAULT TRUE,
  "featured_achievement_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "community_profile_preferences_pkey" PRIMARY KEY ("guild_id", "user_id")
);

CREATE INDEX "community_profile_preferences_guild_id_is_public_idx"
  ON "community_profile_preferences" ("guild_id", "is_public");
