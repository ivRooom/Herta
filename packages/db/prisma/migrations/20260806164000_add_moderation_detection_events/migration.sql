CREATE TABLE "moderation_detection_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guild_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "detection_kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "message_length" INTEGER NOT NULL,
    "observed_count" INTEGER,
    "threshold" INTEGER,
    "rule_index" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "review_status" TEXT NOT NULL DEFAULT 'unreviewed',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_detection_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_detection_events_guild_id_fkey"
      FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "moderation_detection_events_kind_check"
      CHECK ("detection_kind" IN (
        'word_exact',
        'word_contains',
        'word_regex',
        'invite_link',
        'mention_burst',
        'message_burst',
        'duplicate_message'
      )),
    CONSTRAINT "moderation_detection_events_mode_check"
      CHECK ("mode" = 'observe'),
    CONSTRAINT "moderation_detection_events_review_status_check"
      CHECK ("review_status" IN ('unreviewed', 'confirmed', 'false_positive', 'ignored')),
    CONSTRAINT "moderation_detection_events_message_length_check"
      CHECK ("message_length" >= 0),
    CONSTRAINT "moderation_detection_events_observed_count_check"
      CHECK ("observed_count" IS NULL OR "observed_count" >= 0),
    CONSTRAINT "moderation_detection_events_threshold_check"
      CHECK ("threshold" IS NULL OR "threshold" >= 0),
    CONSTRAINT "moderation_detection_events_rule_index_check"
      CHECK ("rule_index" IS NULL OR "rule_index" >= 0),
    CONSTRAINT "moderation_detection_events_review_note_check"
      CHECK ("review_note" IS NULL OR char_length("review_note") <= 500)
);

CREATE UNIQUE INDEX "moderation_detection_events_idempotency_key_key"
  ON "moderation_detection_events"("idempotency_key");

CREATE INDEX "moderation_detection_events_guild_id_occurred_at_idx"
  ON "moderation_detection_events"("guild_id", "occurred_at" DESC);

CREATE INDEX "moderation_detection_events_guild_id_review_status_occurred_at_idx"
  ON "moderation_detection_events"("guild_id", "review_status", "occurred_at" DESC);

CREATE INDEX "moderation_detection_events_guild_id_detection_kind_occurred_at_idx"
  ON "moderation_detection_events"("guild_id", "detection_kind", "occurred_at" DESC);

CREATE INDEX "moderation_detection_events_guild_id_user_id_occurred_at_idx"
  ON "moderation_detection_events"("guild_id", "user_id", "occurred_at" DESC);
