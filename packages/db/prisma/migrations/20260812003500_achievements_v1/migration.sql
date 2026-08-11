CREATE TABLE "achievement_unlocks" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "achievement_id" TEXT NOT NULL,
  "unlocked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "achievement_unlocks_pkey" PRIMARY KEY ("guild_id", "user_id", "achievement_id"),
  CONSTRAINT "achievement_unlocks_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "achievement_unlocks_id_length_check" CHECK (char_length("achievement_id") BETWEEN 1 AND 64)
);

CREATE INDEX "achievement_unlocks_guild_user_idx"
  ON "achievement_unlocks" ("guild_id", "user_id", "unlocked_at" DESC);
CREATE INDEX "achievement_unlocks_guild_achievement_idx"
  ON "achievement_unlocks" ("guild_id", "achievement_id", "unlocked_at" DESC);
