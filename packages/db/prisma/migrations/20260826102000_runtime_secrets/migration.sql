-- Global runtime credentials are encrypted by the application before storage.
-- The plaintext value and the master encryption key must never be persisted here.
CREATE TABLE "runtime_secrets" (
    "name" VARCHAR(100) NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_secrets_pkey" PRIMARY KEY ("name"),
    CONSTRAINT "runtime_secrets_name_nonempty" CHECK (char_length("name") > 0),
    CONSTRAINT "runtime_secrets_ciphertext_bounds" CHECK (octet_length("ciphertext") BETWEEN 1 AND 4112),
    CONSTRAINT "runtime_secrets_iv_length" CHECK (octet_length("iv") = 12),
    CONSTRAINT "runtime_secrets_auth_tag_length" CHECK (octet_length("auth_tag") = 16),
    CONSTRAINT "runtime_secrets_key_version_positive" CHECK ("key_version" >= 1)
);
