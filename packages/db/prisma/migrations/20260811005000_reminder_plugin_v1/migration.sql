CREATE TABLE "reminders" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel_id" TEXT,
  "delivery" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "remind_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
  "error_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMPTZ(3),

  CONSTRAINT "reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminders_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reminders_delivery_check" CHECK ("delivery" IN ('channel', 'dm')),
  CONSTRAINT "reminders_status_check"
    CHECK ("status" IN ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
  CONSTRAINT "reminders_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "reminders_message_length_check" CHECK (char_length("message") BETWEEN 1 AND 1000)
);

CREATE INDEX "reminders_due_idx"
  ON "reminders" ("guild_id", "status", "next_attempt_at", "remind_at");

CREATE INDEX "reminders_user_active_idx"
  ON "reminders" ("guild_id", "user_id", "status", "remind_at");
