CREATE TABLE IF NOT EXISTS "message_studio_drafts" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_studio_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "message_studio_drafts_guild_author_updated_idx"
    ON "message_studio_drafts" ("guild_id", "author_id", "updated_at" DESC);
