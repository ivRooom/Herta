CREATE TABLE "ai_guild_monthly_budget_usage" (
  "guild_id" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "reserved_micro_usd" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "ai_guild_monthly_budget_usage_pkey" PRIMARY KEY ("guild_id", "period_start")
);
