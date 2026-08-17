-- Discord Roleの作成・削除を再起動耐性のある非同期操作として管理する。
CREATE TABLE "discord_role_operations" (
    "id" UUID NOT NULL,
    "guild_id" TEXT NOT NULL,
    "operation" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "source" VARCHAR(32) NOT NULL,
    "discord_role_id" TEXT,
    "role_name" VARCHAR(100),
    "role_color" INTEGER,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "expires_after_seconds" INTEGER,
    "next_attempt_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_error_name" VARCHAR(120),
    "parent_operation_id" UUID,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_role_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discord_role_operations_operation_check" CHECK ("operation" IN ('create', 'delete')),
    CONSTRAINT "discord_role_operations_status_check" CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT "discord_role_operations_source_check" CHECK ("source" IN ('studio', 'temporary-expiry', 'rule-engine')),
    CONSTRAINT "discord_role_operations_role_color_check" CHECK ("role_color" IS NULL OR ("role_color" >= 0 AND "role_color" <= 16777215)),
    CONSTRAINT "discord_role_operations_expiry_check" CHECK ("expires_after_seconds" IS NULL OR ("expires_after_seconds" >= 60 AND "expires_after_seconds" <= 31536000)),
    CONSTRAINT "discord_role_operations_create_payload_check" CHECK ("operation" <> 'create' OR ("role_name" IS NOT NULL AND length(btrim("role_name")) BETWEEN 1 AND 100)),
    CONSTRAINT "discord_role_operations_delete_payload_check" CHECK ("operation" <> 'delete' OR "discord_role_id" ~ '^[0-9]{17,20}$')
);

ALTER TABLE "discord_role_operations"
    ADD CONSTRAINT "discord_role_operations_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discord_role_operations"
    ADD CONSTRAINT "discord_role_operations_parent_operation_id_fkey"
    FOREIGN KEY ("parent_operation_id") REFERENCES "discord_role_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "discord_role_operations_due_idx"
    ON "discord_role_operations"("status", "scheduled_for");

CREATE INDEX "discord_role_operations_retry_idx"
    ON "discord_role_operations"("status", "next_attempt_at");

CREATE INDEX "discord_role_operations_guild_recent_idx"
    ON "discord_role_operations"("guild_id", "created_at" DESC);

-- 同一Roleへの未完了deleteを1件へ集約し、二重クリックやTTL/manual delete競合を抑止する。
CREATE UNIQUE INDEX "discord_role_operations_open_delete_unique"
    ON "discord_role_operations"("guild_id", "discord_role_id")
    WHERE "operation" = 'delete' AND "status" IN ('pending', 'processing');

-- temporary roleのexpiry deleteはcreate operationごとに高々1件だけ生成する。
CREATE UNIQUE INDEX "discord_role_operations_parent_delete_unique"
    ON "discord_role_operations"("parent_operation_id")
    WHERE "operation" = 'delete' AND "parent_operation_id" IS NOT NULL;
