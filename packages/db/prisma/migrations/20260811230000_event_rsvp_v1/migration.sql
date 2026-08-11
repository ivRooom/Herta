CREATE TABLE "community_events" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "creator_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(1000),
  "location" VARCHAR(200),
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tokyo',
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "registration_closes_at" TIMESTAMPTZ(3) NOT NULL,
  "capacity" INTEGER,
  "status" VARCHAR(16) NOT NULL DEFAULT 'open',
  "allow_maybe" BOOLEAN NOT NULL DEFAULT TRUE,
  "allow_waitlist" BOOLEAN NOT NULL DEFAULT TRUE,
  "reminder_minutes" INTEGER NOT NULL DEFAULT 60,
  "reminder_sent_at" TIMESTAMPTZ(3),
  "reminder_claimed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_events_title_check" CHECK (char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "community_events_description_check" CHECK ("description" IS NULL OR char_length("description") <= 1000),
  CONSTRAINT "community_events_location_check" CHECK ("location" IS NULL OR char_length("location") <= 200),
  CONSTRAINT "community_events_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 500),
  CONSTRAINT "community_events_status_check" CHECK ("status" IN ('open', 'closed', 'cancelled')),
  CONSTRAINT "community_events_reminder_check" CHECK ("reminder_minutes" BETWEEN 0 AND 10080)
);

CREATE TABLE "event_rsvps" (
  "event_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("event_id", "user_id"),
  CONSTRAINT "event_rsvps_status_check" CHECK ("status" IN ('going', 'maybe', 'declined', 'waitlist')),
  CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "community_events_guild_start_idx" ON "community_events"("guild_id", "starts_at");
CREATE INDEX "community_events_due_idx" ON "community_events"("guild_id", "status", "registration_closes_at");
CREATE INDEX "community_events_creator_idx" ON "community_events"("guild_id", "creator_id", "starts_at");
CREATE INDEX "community_events_reminder_idx" ON "community_events"("guild_id", "reminder_sent_at", "starts_at");
CREATE INDEX "event_rsvps_status_idx" ON "event_rsvps"("event_id", "status", "created_at");
