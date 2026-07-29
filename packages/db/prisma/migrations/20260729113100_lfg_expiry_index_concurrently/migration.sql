-- Keep this migration isolated because PostgreSQL forbids CONCURRENTLY inside a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "lfg_posts_status_expires_at_idx"
  ON "lfg_posts" ("status", "expires_at")
  WHERE "deleted_at" IS NULL;
