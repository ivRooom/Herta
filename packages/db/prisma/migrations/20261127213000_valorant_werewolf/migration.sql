-- Werewolf mode for VALORANT troll gacha (#1049).
-- The pick session stays the room shell (recruitment, participants, VC
-- auto-join); werewolf progression lives in its own tables so the secret
-- assignment NEVER lands in valorant_pick_sessions.result, which the
-- public embeds, pick cards and Studio APIs read verbatim.
--   * valorant_werewolf_games   - public progression + resolved outcome
--   * valorant_werewolf_secrets - werewolf identity + secret troll only
--   * valorant_werewolf_votes   - per-round votes, PK prevents doubles
-- Existing rows are untouched: no backfill, and non-werewolf sessions
-- keep behaving exactly as before.
BEGIN;

-- WEREWOLF rooms run OPEN -> IN_PROGRESS -> COMPLETED/CANCELLED; the
-- IN_PROGRESS status also freezes join/leave/manage/VC auto-join, whose
-- mutations all re-check status = 'OPEN' under the session row lock.
ALTER TABLE "valorant_pick_sessions"
  DROP CONSTRAINT "valorant_pick_sessions_status_check",
  ADD CONSTRAINT "valorant_pick_sessions_status_check"
    CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'));
ALTER TABLE "valorant_pick_sessions"
  DROP CONSTRAINT "valorant_pick_sessions_mode_check",
  ADD CONSTRAINT "valorant_pick_sessions_mode_check"
    CHECK ("mode" IN ('RANDOM', 'TACTICAL', 'WEREWOLF'));

CREATE TABLE "valorant_werewolf_games" (
  "session_id" TEXT NOT NULL PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "phase" VARCHAR(16) NOT NULL DEFAULT 'ASSIGNING',
  "roster_snapshot" JSONB NOT NULL DEFAULT '[]',
  "current_round" INTEGER NOT NULL DEFAULT 0,
  "current_candidate_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "round_history" JSONB NOT NULL DEFAULT '[]',
  "first_round_tally" JSONB,
  "vote_ends_at" TIMESTAMPTZ(3),
  "assignment_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "assignment_error_code" VARCHAR(40),
  "outcome" VARCHAR(16),
  "outcome_reason" VARCHAR(24),
  "accused_user_id" TEXT,
  "punishment_status" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
  "punishment_error_code" VARCHAR(40),
  "punishment_user_id" TEXT,
  "punishment_draw_id" VARCHAR(64),
  "punishment_item_id" VARCHAR(64),
  "punishment_text" TEXT,
  "punishment_rarity" VARCHAR(16),
  "punishment_category" VARCHAR(16),
  "revealed_troll_item_id" VARCHAR(64),
  "revealed_troll_text" TEXT,
  "revealed_troll_rarity" VARCHAR(16),
  "revealed_troll_category" VARCHAR(16),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voting_started_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "aborted_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "valorant_werewolf_games_session_fkey" FOREIGN KEY ("session_id", "guild_id")
    REFERENCES "valorant_pick_sessions"("id", "guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valorant_werewolf_games_phase_check"
    CHECK ("phase" IN ('ASSIGNING', 'PLAYING', 'VOTING', 'RUNOFF', 'RESOLVING', 'RESOLVED', 'ABORTED')),
  CONSTRAINT "valorant_werewolf_games_assignment_status_check"
    CHECK ("assignment_status" IN ('PENDING', 'READY', 'FAILED', 'INVALID_RESPONSE')),
  CONSTRAINT "valorant_werewolf_games_punishment_status_check"
    CHECK ("punishment_status" IN ('NOT_STARTED', 'PENDING', 'READY', 'UNAVAILABLE')),
  CONSTRAINT "valorant_werewolf_games_outcome_check"
    CHECK ("outcome" IS NULL OR "outcome" IN ('CITIZENS_WIN', 'WEREWOLF_WIN')),
  CONSTRAINT "valorant_werewolf_games_current_round_check" CHECK ("current_round" >= 0)
);
CREATE UNIQUE INDEX "valorant_werewolf_games_session_id_guild_id_key"
  ON "valorant_werewolf_games"("session_id", "guild_id");
CREATE INDEX "valorant_werewolf_games_guild_id_phase_updated_at_idx"
  ON "valorant_werewolf_games"("guild_id", "phase", "updated_at");
CREATE INDEX "valorant_werewolf_games_guild_id_resolved_at_idx"
  ON "valorant_werewolf_games"("guild_id", "resolved_at");

CREATE TABLE "valorant_werewolf_secrets" (
  "session_id" TEXT NOT NULL PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "werewolf_user_id" TEXT NOT NULL,
  "draw_id" VARCHAR(64),
  "troll_item_id" VARCHAR(64),
  "troll_text" TEXT,
  "troll_rarity" VARCHAR(16),
  "troll_category" VARCHAR(16),
  "assigned_at" TIMESTAMPTZ(3),
  "secret_viewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "valorant_werewolf_secrets_game_fkey" FOREIGN KEY ("session_id", "guild_id")
    REFERENCES "valorant_werewolf_games"("session_id", "guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "valorant_werewolf_secrets_session_id_guild_id_key"
  ON "valorant_werewolf_secrets"("session_id", "guild_id");

CREATE TABLE "valorant_werewolf_votes" (
  "session_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "voter_user_id" TEXT NOT NULL,
  "target_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "valorant_werewolf_votes_pkey" PRIMARY KEY ("session_id", "round", "voter_user_id"),
  CONSTRAINT "valorant_werewolf_votes_game_fkey" FOREIGN KEY ("session_id", "guild_id")
    REFERENCES "valorant_werewolf_games"("session_id", "guild_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valorant_werewolf_votes_round_check" CHECK ("round" >= 1)
);
CREATE INDEX "valorant_werewolf_votes_session_id_round_target_user_id_idx"
  ON "valorant_werewolf_votes"("session_id", "round", "target_user_id");

COMMIT;
