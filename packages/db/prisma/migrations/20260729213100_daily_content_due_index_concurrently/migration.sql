CREATE INDEX CONCURRENTLY "daily_contents_enabled_next_run_at_idx"
  ON "daily_contents"("enabled", "next_run_at" ASC);
