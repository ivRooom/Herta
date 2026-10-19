CREATE TABLE "voice_consent_access" (
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "voice_consent_access_pkey" PRIMARY KEY ("user_id")
);
CREATE UNIQUE INDEX "voice_consent_access_token_hash_key" ON "voice_consent_access"("token_hash");
