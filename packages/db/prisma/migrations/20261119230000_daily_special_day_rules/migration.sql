-- Special-day title/intro overrides for the 09:00 daily bonus
-- announcement (#705). Rules are owned by Herta (one row per guild and
-- target): kind 'date' pins an exact JST date, kind 'annual' repeats
-- every year on a month-day. The bot resolves date > annual at send
-- time; Studio management and preview arrive in a later slice.
CREATE TABLE "daily_special_day_rules" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "exact_date" TEXT,
    "month_day" TEXT,
    "title" TEXT,
    "intro" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_special_day_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_special_day_rules_kind_check" CHECK ("kind" IN ('date', 'annual')),
    CONSTRAINT "daily_special_day_rules_target_check" CHECK (
        ("kind" = 'date' AND "exact_date" IS NOT NULL AND "month_day" IS NULL)
        OR ("kind" = 'annual' AND "month_day" IS NOT NULL AND "exact_date" IS NULL)
    ),
    CONSTRAINT "daily_special_day_rules_content_check" CHECK (
        "title" IS NOT NULL OR "intro" IS NOT NULL
    )
);

-- PostgreSQL unique indexes treat NULLs as distinct, so each index
-- constrains only the rows of its own kind.
CREATE UNIQUE INDEX "daily_special_day_rules_guild_exact_date_key"
    ON "daily_special_day_rules"("guild_id", "exact_date");
CREATE UNIQUE INDEX "daily_special_day_rules_guild_month_day_key"
    ON "daily_special_day_rules"("guild_id", "month_day");
CREATE INDEX "daily_special_day_rules_guild_id_idx"
    ON "daily_special_day_rules"("guild_id");

ALTER TABLE "daily_special_day_rules"
    ADD CONSTRAINT "daily_special_day_rules_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
