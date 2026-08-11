CREATE TABLE "giveaways" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "creator_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT,
  "prize" TEXT NOT NULL,
  "winner_count" INTEGER NOT NULL,
  "announce_winners" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'open',
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "giveaways_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "giveaways_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "giveaways_status_check" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "giveaways_prize_length_check" CHECK (char_length("prize") BETWEEN 1 AND 200),
  CONSTRAINT "giveaways_winner_count_check" CHECK ("winner_count" BETWEEN 1 AND 20)
);

CREATE TABLE "giveaway_entries" (
  "giveaway_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "giveaway_entries_pkey" PRIMARY KEY ("giveaway_id", "user_id"),
  CONSTRAINT "giveaway_entries_giveaway_id_fkey"
    FOREIGN KEY ("giveaway_id") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "giveaway_winners" (
  "giveaway_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "selected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "giveaway_winners_pkey" PRIMARY KEY ("giveaway_id", "position"),
  CONSTRAINT "giveaway_winners_unique_user" UNIQUE ("giveaway_id", "user_id"),
  CONSTRAINT "giveaway_winners_position_check" CHECK ("position" BETWEEN 0 AND 19),
  CONSTRAINT "giveaway_winners_giveaway_id_fkey"
    FOREIGN KEY ("giveaway_id") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "giveaways_guild_due_idx"
  ON "giveaways"("guild_id", "status", "ends_at");
CREATE INDEX "giveaways_creator_active_idx"
  ON "giveaways"("guild_id", "creator_id", "status", "ends_at");
CREATE INDEX "giveaways_pending_finalization_idx"
  ON "giveaways"("guild_id", "status", "finalized_at", "closed_at");
CREATE INDEX "giveaway_entries_user_idx"
  ON "giveaway_entries"("user_id", "giveaway_id");
