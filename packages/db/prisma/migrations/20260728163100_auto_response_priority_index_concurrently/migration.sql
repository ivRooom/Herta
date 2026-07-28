-- 既存auto_responsesへの書き込みを止めないため、このmigrationは単一SQL文を維持する。
CREATE INDEX CONCURRENTLY "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
