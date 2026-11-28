-- Portal operation actor records for VALORANT pick sessions (#1050, S6-H2).
--   * valorant_pick_session_actions - one row per recorded operation:
--     who (actor_user_id), from where (source: discord | portal) and what
--     (action). Portal-origin operations are always recorded; Discord
--     flows only opt in where they already track creation source.
--   * idempotency_key (unique, nullable) rides on the same table: portal
--     create / reroll require a key, and a replay resolves to the session
--     recorded here instead of creating a second session.
-- Actor IDs fall under the same 90-day retention as the sessions
-- themselves (packages/db/src/valorant-retention.ts anonymizes them).
-- Existing rows are untouched: no backfill.
BEGIN;

CREATE TABLE "valorant_pick_session_actions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "session_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "source" VARCHAR(16) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "idempotency_key" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "valorant_pick_session_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "valorant_pick_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valorant_pick_session_actions_source_check" CHECK ("source" IN ('discord', 'portal'))
);
CREATE UNIQUE INDEX "valorant_pick_session_actions_idempotency_key_key" ON "valorant_pick_session_actions"("idempotency_key");
CREATE INDEX "valorant_pick_session_actions_session_id_created_at_idx" ON "valorant_pick_session_actions"("session_id", "created_at");
CREATE INDEX "valorant_pick_session_actions_actor_user_id_created_at_idx" ON "valorant_pick_session_actions"("actor_user_id", "created_at");

COMMIT;
