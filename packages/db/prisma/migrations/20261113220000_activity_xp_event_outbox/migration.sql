-- Activity XP emitter outbox (ivrm-web Points v3, Herta #877): durable delivery
-- state for hourly activity XP envelopes sent to ivrm-web.
-- Non-destructive: a new empty table only. Rows are written solely while
-- HERTA_XP_EMITTER_ENABLED=true; no existing table is read or changed by this DDL.
CREATE TABLE "activity_xp_event_outbox" (
  "id" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "event_type" VARCHAR(32) NOT NULL,
  "body" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "last_status" INTEGER,
  "last_error" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "activity_xp_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_xp_event_outbox_source_event_id_key"
  ON "activity_xp_event_outbox"("source_event_id");

CREATE INDEX "activity_xp_event_outbox_status_next_attempt_at_idx"
  ON "activity_xp_event_outbox"("status", "next_attempt_at");
