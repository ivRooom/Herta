-- Prisma migration transaction外で適用すること。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "suggestions_staff_queue_idx"
  ON "suggestions" ("guild_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "suggestions_staff_queue_recent_idx"
  ON "suggestions" ("guild_id", "created_at" DESC, "id" DESC);
