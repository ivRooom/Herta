-- Global non-secret runtime configuration store.
-- Secrets must continue to use runtime_secrets; this table is for allowlisted typed metadata only.
CREATE TABLE "runtime_configurations" (
  "name" VARCHAR(100) NOT NULL,
  "value" JSONB NOT NULL,
  "updated_by" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_configurations_pkey" PRIMARY KEY ("name"),
  CONSTRAINT "runtime_configurations_value_object_check" CHECK (jsonb_typeof("value") = 'object'),
  CONSTRAINT "runtime_configurations_value_size_check" CHECK (octet_length("value"::text) <= 16384)
);
