-- Separate, purpose/version-scoped opt-in. Legacy 30-day consent is intentionally not copied.
-- No data backfill: an empty table is fail-closed for long-term storage and recording.
CREATE TABLE "vc_recap_explicit_consents" (
  "user_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "consented_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vc_recap_explicit_consents_pkey" PRIMARY KEY ("user_id", "purpose"),
  CONSTRAINT "vc_recap_explicit_consents_purpose_check"
    CHECK ("purpose" IN ('transcription', 'transcript_long_term', 'audio_long_term')),
  CONSTRAINT "vc_recap_explicit_consents_state_check"
    CHECK ("consented_at" IS NULL OR "revoked_at" IS NULL)
);
CREATE INDEX "vc_recap_explicit_consents_user_id_updated_at_idx"
  ON "vc_recap_explicit_consents"("user_id", "updated_at");
