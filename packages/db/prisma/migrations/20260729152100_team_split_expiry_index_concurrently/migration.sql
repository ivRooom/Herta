-- Prisma migration transaction外で適用すること。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "team_split_sessions_due_idx"
  ON "team_split_sessions" ("expires_at", "guild_id")
  WHERE "status" IN ('open', 'split') AND "deleted_at" IS NULL;
