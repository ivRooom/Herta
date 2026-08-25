-- Prisma migration transaction外で適用すること。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_guild_target_created_id_idx"
  ON "audit_logs" ("guild_id", "target_type", "target_id", "created_at" DESC, "id" DESC);
