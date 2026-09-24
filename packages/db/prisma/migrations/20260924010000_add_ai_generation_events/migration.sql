CREATE TABLE "ai_generation_events" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "model_profile" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "result_category" TEXT NOT NULL,
    "error_category" TEXT,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DOUBLE PRECISION NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_generation_events_result_category_check"
        CHECK ("result_category" IN ('success', 'rejected', 'failed')),
    CONSTRAINT "ai_generation_events_duration_ms_check"
        CHECK ("duration_ms" >= 0 AND "duration_ms" <= 600000),
    CONSTRAINT "ai_generation_events_input_tokens_check"
        CHECK ("input_tokens" >= 0),
    CONSTRAINT "ai_generation_events_output_tokens_check"
        CHECK ("output_tokens" >= 0),
    CONSTRAINT "ai_generation_events_total_tokens_check"
        CHECK ("total_tokens" >= 0),
    CONSTRAINT "ai_generation_events_estimated_cost_usd_check"
        CHECK ("estimated_cost_usd" >= 0)
);

CREATE INDEX "ai_generation_events_occurred_at_idx"
    ON "ai_generation_events" ("occurred_at" DESC);

CREATE INDEX "ai_generation_events_provider_occurred_at_idx"
    ON "ai_generation_events" ("provider", "occurred_at" DESC);

CREATE INDEX "ai_generation_events_guild_id_occurred_at_idx"
    ON "ai_generation_events" ("guild_id", "occurred_at" DESC);
