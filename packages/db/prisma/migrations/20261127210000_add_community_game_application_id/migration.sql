-- Community game activity: record the Discord application_id alongside the
-- activity name (S7a, #1060) so the read side can group the same game across
-- localized / renamed presence names (S7b). The id is not always available
-- (unregistered detections report null), and primary-key columns cannot be
-- NULL, so unknown ids are stored as the empty-string sentinel ''.
--
-- Non-destructive and backward-compatible: both columns are added with
-- DEFAULT '', so every existing row keeps its name-keyed identity and past
-- data is NOT rewritten or merged retroactively (merging past rows happens
-- only at read time via the name mapping in S7b). The daily primary key is
-- widened to include application_id; same-name rows with different ids are
-- stored separately from now on, and name-based SUM/groupBy readers stay
-- correct without changes.
ALTER TABLE "community_game_sessions"
  ADD COLUMN "application_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "community_game_activity_daily"
  ADD COLUMN "application_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "community_game_activity_daily"
  DROP CONSTRAINT "community_game_activity_daily_pkey",
  ADD CONSTRAINT "community_game_activity_daily_pkey"
    PRIMARY KEY ("guild_id", "user_id", "activity_name", "application_id", "activity_date");

CREATE INDEX "community_game_activity_daily_guild_app_date_idx"
  ON "community_game_activity_daily" ("guild_id", "application_id", "activity_date");
