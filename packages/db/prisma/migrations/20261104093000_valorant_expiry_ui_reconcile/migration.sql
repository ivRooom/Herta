-- Additive per-session Discord public-expiry UI reconciliation state.
-- NULL = never successfully synchronized, including sessions created before rollout.
ALTER TABLE "valorant_pick_sessions"
  ADD COLUMN "expiry_ui_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "expiry_ui_retry_at" TIMESTAMPTZ(3),
  ADD COLUMN "expiry_ui_retry_count" INTEGER NOT NULL DEFAULT 0;
