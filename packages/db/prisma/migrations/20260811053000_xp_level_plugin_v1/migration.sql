CREATE TABLE "xp_profiles" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "xp" BIGINT NOT NULL DEFAULT 0,
  "last_xp_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "xp_profiles_pkey" PRIMARY KEY ("guild_id", "user_id"),
  CONSTRAINT "xp_profiles_xp_non_negative" CHECK ("xp" >= 0)
);

CREATE INDEX "xp_profiles_guild_xp_idx"
  ON "xp_profiles" ("guild_id", "xp" DESC, "updated_at" ASC);
