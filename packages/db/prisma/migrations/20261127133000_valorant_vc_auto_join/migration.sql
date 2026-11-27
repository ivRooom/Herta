-- Per-session VC auto-join opt-in for VALORANT random picks (#1048).
-- When a recruitment is created with vc_auto_join = true, members who join
-- the pinned voice channel are registered as participants automatically.
-- The flag must stay separate from voice_channel_id: every recruitment
-- created while the creator sits in a VC already pins that VC for the
-- manual snapshot flow, and migration 20261103160000 keeps those rows
-- manual-only. Reusing the pinned VC as the trigger would silently turn
-- every existing recruitment into a live auto-join session.
-- Non-destructive, backward-compatible: existing rows default to false.
ALTER TABLE "valorant_pick_sessions"
  ADD COLUMN "vc_auto_join" BOOLEAN NOT NULL DEFAULT false;
