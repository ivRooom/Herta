-- Additive, guild-scoped VALORANT recruitment and immutable completed draw history.
BEGIN;
CREATE TABLE "valorant_pick_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT,
  "creator_id" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "mode" VARCHAR(16) NOT NULL,
  "map_id" VARCHAR(32),
  "max_participants" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "rules_version" VARCHAR(32) NOT NULL,
  "candidates" JSONB NOT NULL DEFAULT '[]',
  "result" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "valorant_pick_sessions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valorant_pick_sessions_status_check" CHECK ("status" IN ('OPEN', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT "valorant_pick_sessions_mode_check" CHECK ("mode" IN ('RANDOM', 'TACTICAL')),
  CONSTRAINT "valorant_pick_sessions_capacity_check" CHECK ("max_participants" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "valorant_pick_sessions_message_id_key" ON "valorant_pick_sessions"("message_id");
CREATE INDEX "valorant_pick_sessions_guild_id_status_expires_at_idx" ON "valorant_pick_sessions"("guild_id", "status", "expires_at");
CREATE INDEX "valorant_pick_sessions_guild_id_completed_at_idx" ON "valorant_pick_sessions"("guild_id", "completed_at");

CREATE TABLE "valorant_pick_participants" (
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "valorant_pick_participants_pkey" PRIMARY KEY ("session_id", "user_id"),
  CONSTRAINT "valorant_pick_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "valorant_pick_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMIT;
