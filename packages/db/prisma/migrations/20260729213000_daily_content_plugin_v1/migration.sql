ALTER TABLE "daily_contents"
  ADD COLUMN "next_run_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_scheduled_at" TIMESTAMPTZ(3),
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

ALTER TABLE "daily_contents"
  ALTER COLUMN "last_sent_at" TYPE TIMESTAMPTZ(3)
  USING "last_sent_at" AT TIME ZONE 'UTC';

CREATE TABLE "daily_content_deliveries" (
  "id" TEXT NOT NULL,
  "daily_content_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'scheduled',
  "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "message_id" TEXT,
  "error_name" TEXT,
  "queued_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "daily_content_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_content_deliveries_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "daily_content_deliveries_daily_content_id_fkey"
    FOREIGN KEY ("daily_content_id") REFERENCES "daily_contents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "daily_contents"
  ADD CONSTRAINT "daily_contents_schedule_time_check"
  CHECK ("schedule_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') NOT VALID;

ALTER TABLE "daily_content_deliveries"
  ADD CONSTRAINT "daily_content_deliveries_origin_check"
  CHECK ("origin" IN ('scheduled', 'manual')),
  ADD CONSTRAINT "daily_content_deliveries_status_check"
  CHECK ("status" IN ('pending', 'queued', 'processing', 'retrying', 'sent', 'failed', 'skipped')),
  ADD CONSTRAINT "daily_content_deliveries_attempt_count_check"
  CHECK ("attempt_count" BETWEEN 0 AND 100);

CREATE INDEX "daily_content_deliveries_guild_id_created_at_idx"
  ON "daily_content_deliveries"("guild_id", "created_at" DESC);
CREATE INDEX "daily_content_deliveries_status_next_attempt_at_idx"
  ON "daily_content_deliveries"("status", "next_attempt_at" ASC);
CREATE INDEX "daily_content_deliveries_daily_content_id_scheduled_for_idx"
  ON "daily_content_deliveries"("daily_content_id", "scheduled_for" DESC);
