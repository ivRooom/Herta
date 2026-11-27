-- Per-session troll-gacha opt-outs for VALORANT random picks (#1047).
-- Participants toggle their own ID while the recruitment is OPEN; the draw
-- passes these IDs to the ivrm-web troll engine as exclusions.
-- Non-destructive, backward-compatible: existing rows default to no opt-outs.
ALTER TABLE "valorant_pick_sessions"
  ADD COLUMN "troll_off_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
