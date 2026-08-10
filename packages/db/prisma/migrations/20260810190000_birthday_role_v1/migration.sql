CREATE TABLE "birthday_registrations" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birthday_registrations_pkey" PRIMARY KEY ("guild_id", "user_id"),
    CONSTRAINT "birthday_registrations_month_check" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "birthday_registrations_day_check" CHECK ("day" BETWEEN 1 AND 31)
);

CREATE INDEX "birthday_registrations_guild_id_month_day_idx"
ON "birthday_registrations"("guild_id", "month", "day");

CREATE TABLE "birthday_deliveries" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message_id" TEXT,
    "error_name" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "reconciled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "birthday_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "birthday_deliveries_idempotency_key_key"
ON "birthday_deliveries"("idempotency_key");

CREATE INDEX "birthday_deliveries_guild_id_local_date_kind_idx"
ON "birthday_deliveries"("guild_id", "local_date", "kind");

CREATE INDEX "birthday_deliveries_cleanup_idx"
ON "birthday_deliveries"("guild_id", "reconciled_at", "local_date")
WHERE "status" = 'completed' AND "kind" LIKE 'role-assigned:%';

CREATE INDEX "birthday_deliveries_status_created_at_idx"
ON "birthday_deliveries"("status", "created_at");
