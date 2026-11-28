-- Erasure cases for the ticket-integrated voice-data deletion flow
-- (Herta #750, method B): one row per deletion request, holding the review
-- state and the ticket correlation key (request_id = contract v1.1
-- erasureRequestId). The write fence itself stays in
-- vc_recap_erasure_requests and is not changed by this DDL.
-- Non-destructive: one new empty table only.
CREATE TABLE "vc_recap_erasure_cases" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT,
    "ticket_id" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "recording_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" TEXT,
    "executed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vc_recap_erasure_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vc_recap_erasure_cases_request_id_key"
    ON "vc_recap_erasure_cases"("request_id");

CREATE INDEX "vc_recap_erasure_cases_user_id_status_idx"
    ON "vc_recap_erasure_cases"("user_id", "status");
