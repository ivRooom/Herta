CREATE TABLE "polls" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "creator_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT,
  "question" TEXT NOT NULL,
  "multiple" BOOLEAN NOT NULL DEFAULT FALSE,
  "show_live_results" BOOLEAN NOT NULL DEFAULT TRUE,
  "result_style" TEXT NOT NULL DEFAULT 'percentage',
  "close_announcement" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" TEXT NOT NULL DEFAULT 'open',
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "polls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "polls_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "polls_question_length_check" CHECK (char_length("question") BETWEEN 1 AND 200),
  CONSTRAINT "polls_result_style_check" CHECK ("result_style" IN ('count', 'percentage')),
  CONSTRAINT "polls_status_check" CHECK ("status" IN ('open', 'closed'))
);

CREATE TABLE "poll_options" (
  "poll_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "label" TEXT NOT NULL,

  CONSTRAINT "poll_options_pkey" PRIMARY KEY ("poll_id", "position"),
  CONSTRAINT "poll_options_poll_id_fkey"
    FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "poll_options_position_check" CHECK ("position" BETWEEN 0 AND 9),
  CONSTRAINT "poll_options_label_length_check" CHECK (char_length("label") BETWEEN 1 AND 80)
);

CREATE TABLE "poll_votes" (
  "poll_id" UUID NOT NULL,
  "option_position" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("poll_id", "option_position", "user_id"),
  CONSTRAINT "poll_votes_option_fkey"
    FOREIGN KEY ("poll_id", "option_position")
    REFERENCES "poll_options"("poll_id", "position") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "polls_due_idx" ON "polls" ("guild_id", "status", "ends_at");
CREATE INDEX "polls_creator_active_idx" ON "polls" ("guild_id", "creator_id", "status", "ends_at");
CREATE INDEX "polls_pending_finalization_idx"
  ON "polls" ("guild_id", "status", "finalized_at", "closed_at");
CREATE INDEX "poll_votes_user_idx" ON "poll_votes" ("poll_id", "user_id");
