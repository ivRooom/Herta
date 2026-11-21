-- TEST sends for the daily bonus announcement (#766 Phase D1 / #723).
-- Studio queues a request row; the Bot claims it (CAS), validates the
-- target channel itself and sends exactly one TEST-marked message. Test
-- sends never touch daily_bonus_announcements, never ping the role and
-- are never resent: an unknown delivery outcome stays 'uncertain'.
CREATE TABLE "daily_bonus_test_sends" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "target_date" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "message_id" TEXT,
    "error_code" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_bonus_test_sends_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_bonus_test_sends_status_check"
        CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'uncertain', 'expired')),
    CONSTRAINT "daily_bonus_test_sends_guild_id_fkey"
        FOREIGN KEY ("guild_id") REFERENCES "guilds" ("id") ON DELETE CASCADE
);

CREATE INDEX "daily_bonus_test_sends_guild_status_idx"
    ON "daily_bonus_test_sends" ("guild_id", "status", "created_at");
