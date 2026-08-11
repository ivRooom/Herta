CREATE TABLE "suggestions" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "message_id" TEXT,
  "content" TEXT NOT NULL,
  "anonymous" BOOLEAN NOT NULL DEFAULT FALSE,
  "voting_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "staff_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suggestions_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "suggestions_content_length_check" CHECK (char_length("content") BETWEEN 1 AND 1000),
  CONSTRAINT "suggestions_staff_note_length_check" CHECK ("staff_note" IS NULL OR char_length("staff_note") BETWEEN 1 AND 300),
  CONSTRAINT "suggestions_status_check" CHECK ("status" IN ('pending', 'reviewing', 'accepted', 'rejected', 'completed'))
);

CREATE TABLE "suggestion_votes" (
  "suggestion_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "value" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "suggestion_votes_pkey" PRIMARY KEY ("suggestion_id", "user_id"),
  CONSTRAINT "suggestion_votes_suggestion_id_fkey"
    FOREIGN KEY ("suggestion_id") REFERENCES "suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "suggestion_votes_value_check" CHECK ("value" IN (-1, 1))
);

CREATE INDEX "suggestions_author_open_idx"
  ON "suggestions" ("guild_id", "author_id", "status", "created_at");
CREATE INDEX "suggestions_recent_idx"
  ON "suggestions" ("guild_id", "created_at" DESC);
