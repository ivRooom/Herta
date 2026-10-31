-- VC Recap prospective S3 ownership ledger. No current audio or transcript data is moved.
-- A reserved intent is created BEFORE upload, and is retained during deletion
-- until the full backup/restore erasure workflow is independently verified.
CREATE TABLE "vc_recap_storage_objects" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT,
  "kind" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "version_id" TEXT,
  "state" TEXT NOT NULL DEFAULT 'reserved',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committed_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vc_recap_storage_objects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vc_recap_storage_objects_kind_check" CHECK ("kind" IN ('audio', 'transcript')),
  CONSTRAINT "vc_recap_storage_objects_state_check" CHECK ("state" IN ('reserved', 'committed')),
  CONSTRAINT "vc_recap_storage_objects_commit_check" CHECK (
    ("state" = 'reserved' AND "committed_at" IS NULL)
    OR
    ("state" = 'committed' AND "committed_at" IS NOT NULL AND "version_id" IS NOT NULL)
  )
);

-- Keys are immutable and single-owner: never overwrite an existing key with
-- a new version whose ownership could silently change.
CREATE UNIQUE INDEX "vc_recap_storage_objects_bucket_object_key_key"
ON "vc_recap_storage_objects"("bucket", "object_key");

CREATE INDEX "vc_recap_storage_objects_user_id_state_idx"
ON "vc_recap_storage_objects"("user_id", "state");
