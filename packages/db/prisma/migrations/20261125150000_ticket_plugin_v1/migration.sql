-- Tickets plugin (Herta #749 S3): durable delivery state for the Discord ->
-- ivrm-web ticket bridge, plus the local thread <-> ticket mapping used to
-- recognise ticket threads on messageCreate.
-- Non-destructive: two new empty tables only. Rows are written solely while
-- the tickets plugin is enabled for a guild; no existing table is read or
-- changed by this DDL.
CREATE TABLE "ticket_event_outbox" (
    "id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_status" INTEGER,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_event_outbox_source_event_id_key"
    ON "ticket_event_outbox"("source_event_id");

CREATE INDEX "ticket_event_outbox_status_next_attempt_at_idx"
    ON "ticket_event_outbox"("status", "next_attempt_at");

CREATE INDEX "ticket_event_outbox_guild_id_status_idx"
    ON "ticket_event_outbox"("guild_id", "status");

CREATE TABLE "ticket_thread_links" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "claimed_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_thread_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_thread_links_ticket_id_key"
    ON "ticket_thread_links"("ticket_id");

CREATE UNIQUE INDEX "ticket_thread_links_thread_id_key"
    ON "ticket_thread_links"("thread_id");

CREATE INDEX "ticket_thread_links_guild_id_thread_id_idx"
    ON "ticket_thread_links"("guild_id", "thread_id");
