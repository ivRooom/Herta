-- DB-side deny barrier. An archive worker must not consider this alone proof of S3 deletion.
-- No existing rows or user consents are changed.
CREATE TABLE "vc_recap_erasure_requests" (
  "user_id" TEXT NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storage_deletion_verified_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vc_recap_erasure_requests_pkey" PRIMARY KEY ("user_id")
);
