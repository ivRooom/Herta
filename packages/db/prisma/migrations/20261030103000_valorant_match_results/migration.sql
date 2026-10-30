-- Additive manual results for completed VALORANT draw sessions.
BEGIN;
CREATE UNIQUE INDEX "valorant_pick_sessions_id_guild_id_key" ON "valorant_pick_sessions"("id", "guild_id");
CREATE TABLE "valorant_match_results" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "session_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "map_id" VARCHAR(32) NOT NULL,
  "match_id" VARCHAR(128),
  "source" VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
  "outcome" VARCHAR(8) NOT NULL,
  "rounds_won" INTEGER NOT NULL,
  "rounds_lost" INTEGER NOT NULL,
  "player_results" JSONB NOT NULL DEFAULT '[]',
  "entered_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "valorant_match_results_session_fkey" FOREIGN KEY ("session_id", "guild_id") REFERENCES "valorant_pick_sessions"("id", "guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valorant_match_results_source_check" CHECK ("source" IN ('MANUAL', 'RIOT', 'HENRIK')),
  CONSTRAINT "valorant_match_results_outcome_check" CHECK ("outcome" IN ('WIN', 'LOSS', 'DRAW')),
  CONSTRAINT "valorant_match_results_scores_check" CHECK ("rounds_won" BETWEEN 0 AND 100 AND "rounds_lost" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "valorant_match_results_session_id_key" ON "valorant_match_results"("session_id");
CREATE UNIQUE INDEX "valorant_match_results_session_id_guild_id_key" ON "valorant_match_results"("session_id", "guild_id");
CREATE UNIQUE INDEX "valorant_match_results_guild_id_match_id_key" ON "valorant_match_results"("guild_id", "match_id");
CREATE INDEX "valorant_match_results_guild_id_created_at_idx" ON "valorant_match_results"("guild_id", "created_at");
COMMIT;
