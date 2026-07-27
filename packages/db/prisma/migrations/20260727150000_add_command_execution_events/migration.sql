CREATE TABLE "command_execution_events" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT,
    "command_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_name" TEXT,
    "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_execution_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "command_execution_events_status_check"
        CHECK ("status" IN ('success', 'failure')),
    CONSTRAINT "command_execution_events_duration_ms_check"
        CHECK ("duration_ms" >= 0 AND "duration_ms" <= 300000)
);

CREATE INDEX "command_execution_events_executed_at_idx"
    ON "command_execution_events" ("executed_at" DESC);

CREATE INDEX "command_execution_events_command_name_executed_at_idx"
    ON "command_execution_events" ("command_name", "executed_at" DESC);

CREATE INDEX "command_execution_events_guild_id_executed_at_idx"
    ON "command_execution_events" ("guild_id", "executed_at" DESC);
