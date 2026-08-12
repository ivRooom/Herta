ALTER TABLE "daily_contents"
  ADD COLUMN "recurrence_type" VARCHAR(16) NOT NULL DEFAULT 'daily',
  ADD COLUMN "once_at" TIMESTAMPTZ(3),
  ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "message_format" VARCHAR(16) NOT NULL DEFAULT 'text',
  ADD COLUMN "embed_json" JSONB,
  ADD COLUMN "publish_announcement" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "daily_contents"
  ADD CONSTRAINT "daily_contents_recurrence_type_check"
    CHECK ("recurrence_type" IN ('once', 'daily', 'weekly')),
  ADD CONSTRAINT "daily_contents_message_format_check"
    CHECK ("message_format" IN ('text', 'embed')),
  ADD CONSTRAINT "daily_contents_once_at_check"
    CHECK ("recurrence_type" <> 'once' OR "once_at" IS NOT NULL),
  ADD CONSTRAINT "daily_contents_weekdays_check"
    CHECK (
      "recurrence_type" <> 'weekly'
      OR (
        cardinality("weekdays") > 0
        AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
      )
    );

CREATE INDEX "daily_contents_guild_recurrence_next_run_idx"
  ON "daily_contents" ("guild_id", "recurrence_type", "next_run_at")
  WHERE "deleted_at" IS NULL;
