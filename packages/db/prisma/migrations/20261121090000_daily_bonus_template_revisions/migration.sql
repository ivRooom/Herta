-- Versioned message template for the 09:00 daily bonus announcement
-- (#766 Phase C). A revision moves draft -> pending_review -> approved
-- -> active -> superseded, or pending_review -> rejected when returned.
-- The bot reads the active revision as the base template (the plugin
-- config messageTemplate stays the fallback) and records its id on the
-- announcement as the delivery snapshot.
CREATE TABLE "daily_bonus_template_revisions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "message_template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_bonus_template_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_bonus_template_revisions_status_check" CHECK (
        "status" IN ('draft', 'pending_review', 'approved', 'active', 'superseded', 'rejected')
    ),
    CONSTRAINT "daily_bonus_template_revisions_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "daily_bonus_template_revisions_content_check" CHECK (
        char_length("message_template") BETWEEN 1 AND 1000
    )
);

CREATE UNIQUE INDEX "daily_bonus_template_revisions_guild_revision_key"
    ON "daily_bonus_template_revisions"("guild_id", "revision");
-- At most one active revision per guild. Activation is additionally
-- guarded by a compare-and-swap on the previously active revision.
CREATE UNIQUE INDEX "daily_bonus_template_revisions_one_active_per_guild"
    ON "daily_bonus_template_revisions"("guild_id") WHERE "status" = 'active';
CREATE INDEX "daily_bonus_template_revisions_guild_status_idx"
    ON "daily_bonus_template_revisions"("guild_id", "status");

ALTER TABLE "daily_bonus_template_revisions"
    ADD CONSTRAINT "daily_bonus_template_revisions_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- Delivery snapshot: the template revision a day's announcement used.
-- NULL means the plugin config template was in effect for that day.
ALTER TABLE "daily_bonus_announcements"
    ADD COLUMN "template_revision_id" TEXT;
