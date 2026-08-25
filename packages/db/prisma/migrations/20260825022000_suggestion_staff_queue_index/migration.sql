CREATE INDEX "suggestions_staff_queue_idx"
  ON "suggestions" ("guild_id", "status", "created_at" DESC, "id" DESC);
