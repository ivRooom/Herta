ALTER TABLE "auto_responses"
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_triggered_at" TIMESTAMPTZ(3);

CREATE TABLE "auto_response_execution_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "guild_id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "error_name" TEXT,
  "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auto_response_execution_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auto_response_execution_events_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "auto_responses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "auto_responses_guild_id_priority_created_at_idx"
  ON "auto_responses"("guild_id", "priority" DESC, "created_at" ASC);
CREATE INDEX "auto_response_execution_events_guild_id_executed_at_idx"
  ON "auto_response_execution_events"("guild_id", "executed_at" DESC);
CREATE INDEX "auto_response_execution_events_rule_id_executed_at_idx"
  ON "auto_response_execution_events"("rule_id", "executed_at" DESC);
CREATE INDEX "auto_response_execution_events_status_executed_at_idx"
  ON "auto_response_execution_events"("status", "executed_at" DESC);

ALTER TABLE "auto_response_execution_events"
  ADD CONSTRAINT "auto_response_execution_events_status_check"
  CHECK ("status" IN ('success', 'failure', 'skipped'));

ALTER TABLE "auto_responses"
  ADD CONSTRAINT "auto_responses_match_mode_check"
  CHECK ("match_mode" IN ('exact', 'partial', 'prefix', 'regex')),
  ADD CONSTRAINT "auto_responses_response_type_check"
  CHECK ("response_type" IN ('text', 'embed')),
  ADD CONSTRAINT "auto_responses_cooldown_seconds_check"
  CHECK ("cooldown_seconds" BETWEEN 0 AND 86400),
  ADD CONSTRAINT "auto_responses_priority_check"
  CHECK ("priority" BETWEEN -1000 AND 1000);
