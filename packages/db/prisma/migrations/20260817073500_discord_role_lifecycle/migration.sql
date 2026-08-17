CREATE TABLE "discord_role_lifecycle_operations" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "operation_type" VARCHAR(16) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "execute_at" TIMESTAMPTZ(3) NOT NULL,
    "role_id" TEXT,
    "role_name" VARCHAR(100) NOT NULL,
    "role_color" INTEGER,
    "hoist" BOOLEAN NOT NULL DEFAULT false,
    "mentionable" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3),
    "created_by" TEXT NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "source_operation_id" TEXT,
    "last_error" VARCHAR(160),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discord_role_lifecycle_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discord_role_lifecycle_operations_guild_id_idempotency_key_key"
ON "discord_role_lifecycle_operations"("guild_id", "idempotency_key");

CREATE UNIQUE INDEX "discord_role_lifecycle_operations_source_operation_id_key"
ON "discord_role_lifecycle_operations"("source_operation_id");

CREATE INDEX "discord_role_lifecycle_operations_status_execute_at_idx"
ON "discord_role_lifecycle_operations"("status", "execute_at");

CREATE INDEX "discord_role_lifecycle_operations_guild_id_created_at_idx"
ON "discord_role_lifecycle_operations"("guild_id", "created_at" DESC);

ALTER TABLE "discord_role_lifecycle_operations"
ADD CONSTRAINT "discord_role_lifecycle_operations_guild_id_fkey"
FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
