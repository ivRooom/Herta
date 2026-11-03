-- Preserve pinned VC and explicit self-leave opt-outs for an OPEN VALORANT recruitment.
-- Non-destructive, backward-compatible migration: older recruitment rows remain manual-only.
ALTER TABLE "valorant_pick_sessions"
  ADD COLUMN "voice_channel_id" TEXT,
  ADD COLUMN "opted_out_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
