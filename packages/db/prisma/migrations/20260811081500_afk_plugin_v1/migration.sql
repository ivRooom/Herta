CREATE TABLE "afk_statuses" (
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "afk_statuses_pkey" PRIMARY KEY ("guild_id", "user_id"),
  CONSTRAINT "afk_statuses_reason_length_check" CHECK (char_length("reason") BETWEEN 1 AND 200)
);

CREATE INDEX "afk_statuses_guild_started_at_idx"
  ON "afk_statuses" ("guild_id", "started_at" DESC);
